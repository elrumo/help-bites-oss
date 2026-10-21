import { createHash } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { cleanTopicKeys, normalizeEmail } from '#shared/contacts'
import { normalizeMarketingConfig } from '#shared/marketing'
import { poweredByFor, withPoweredByHtml, withPoweredByText, type PoweredBy } from './branding'
import { publicBaseUrl, unsubscribeLinks } from './campaigns'
import { findContactBy, saveContact, upsertContacts } from './contacts'
import { deliverEmails, newEmailBatchId, SYSTEM_EMAIL_ACTOR } from './emailDelivery'
import { marketingSender } from './campaigns'
import { renderEmailTemplate } from './emails'
import { escapeHtml, renderMessageEmail } from './messageEmail'
import { pageBrand, renderMarketingPage } from './marketingPages'
import { MASTER, useParse, type ParseObject } from './parse'
import { loadProjectUnscoped, normalizeOrigin } from './projects'
import { LIMITS, rateLimit } from './rateLimit'
import { readLinkToken, signLinkToken } from './secrets'

// Newsletter sign-up: a public endpoint (and a hosted page) that takes an
// address for a project, by its public key. With double opt-in the person is
// `pending` until they click the link in a confirmation email; the click is
// their consent, recorded with when and from where. The answer is the same
// whether or not the address was known, so the form reveals nothing.

const CONFIRM_DAYS = 7

/** What a visitor is told when the workspace is at its plan's contact limit. */
export const SIGNUPS_CLOSED = 'Sign-ups are closed right now.'

export type SignupInput = { email: string, name: string, topics: string[] | null, bot: boolean }

/** A form or JSON body. `website` is the honeypot: people leave it empty, bots fill it in. */
export function readSignup(body: Record<string, unknown>): SignupInput {
  const email = normalizeEmail(body.email)
  if (!email) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  // A form with topic boxes says so, so ticking none means none rather than "all".
  const raw = body.topics ?? (body.topics_sent ? [] : undefined)
  const topics = raw === undefined ? null : cleanTopicKeys(typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [])
  return { email, name: String(body.name || '').trim().slice(0, 120), topics, bot: Boolean(String(body.website || '').trim()) }
}

/** A browser form from somewhere else must come from one of the project's sites (or this server's own page). */
export function signupOriginAllowed(origin: string, allowed: string[], own: string): boolean {
  if (!origin) return true
  const o = normalizeOrigin(origin)
  if (o && o === normalizeOrigin(own)) return true
  return !allowed.length || allowed.map(normalizeOrigin).includes(o)
}

export function confirmToken(projectId: string, contactId: string, now = Date.now()): string {
  return signLinkToken('confirm', [projectId, contactId, Math.floor(now / 1000) + CONFIRM_DAYS * 86400].join(':'))
}

export function readConfirmToken(token: string, now = Date.now()): { projectId: string, contactId: string } | null {
  let payload: string | null = null
  try { payload = readLinkToken('confirm', token) } catch { return null }
  const [projectId, contactId, expires] = String(payload || '').split(':')
  if (!projectId || !contactId || !(Number(expires) * 1000 > now)) return null
  return { projectId, contactId }
}

/** A form can be pointed at someone else's address: at most a few mails per address a day, confirmations and preference links together. */
export async function addressMailAllowed(project: ParseObject, email: string): Promise<boolean> {
  try {
    await rateLimit(`sb:rl:confirm:${project.id}:${createHash('sha256').update(email).digest('hex')}`, LIMITS.confirmMailsPerAddress.limit, LIMITS.confirmMailsPerAddress.window)
    return true
  } catch {
    return false
  }
}

/** The built-in email's words; `greeting`, `note` and `reason` replace the message layout's English ones. */
export type ConfirmationCopy = { subject: string, body: string, ctaLabel: string, greeting?: string, note?: string, reason?: string }

/**
 * A confirmation email with `url` behind its button: `template` (a project's
 * own design, which gets {{confirmUrl}}, in the first of `wanted` it has) when
 * there is one, else a plain message with `copy`. Lead forms send theirs
 * through here too.
 */
export async function sendConfirmationEmail(project: ParseObject, contact: ParseObject, url: string, template: ParseObject | null, copy: ConfirmationCopy, wanted: string[] = []): Promise<void> {
  const email = String(contact.get('email') || '')
  if (!await addressMailAllowed(project, email)) return
  const name = String(contact.get('name') || '')
  const poweredBy = await poweredByFor(project)
  const rendered = template
    ? renderEmailTemplate(template, project, { confirmUrl: url, 'recipient.email': email, 'recipient.name': name }, wanted)
    : renderMessageEmail({ appName: String(project.get('name') || ''), senderName: String(project.get('name') || ''), recipientName: name, subject: copy.subject, body: copy.body, ctaUrl: url, ctaLabel: copy.ctaLabel, attachmentUrls: [], poweredBy, greeting: copy.greeting, note: copy.note, reason: copy.reason })
  const key = template ? String(template.get('key') || '') : ''
  await deliverEmails([{
    project,
    to: { email, name },
    subject: rendered.subject,
    // The message layout already carries the badge; the project's own template gets it at the end.
    html: template ? withPoweredByHtml(rendered.html, poweredBy) : rendered.html,
    text: template ? withPoweredByText(rendered.text, poweredBy) : rendered.text,
    sender: marketingSender(project),
    log: { source: 'system', kind: template ? 'template' : 'message', template, templateKey: key, templateName: template ? String(template.get('name') || 'Confirm subscription') : 'Confirm subscription', variables: { confirmUrl: url }, batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
  }])
}

/** The project's own confirmation design (send key `confirm-subscription`), if it has one. */
export async function projectConfirmTemplate(project: ParseObject): Promise<ParseObject | null> {
  return await new (useParse()).Query('EmailTemplate').equalTo('project', project).equalTo('key', 'confirm-subscription').include('master').first(MASTER) || null
}

export async function sendConfirmation(project: ParseObject, contact: ParseObject): Promise<void> {
  const url = `${publicBaseUrl()}/u/confirm/${confirmToken(project.id || '', contact.id || '')}`
  const app = String(project.get('name') || '')
  await sendConfirmationEmail(project, contact, url, await projectConfirmTemplate(project), {
    subject: `Confirm your subscription to ${app || 'our newsletter'}`,
    body: `Please confirm you want email from ${app || 'us'}. If you did not sign up, ignore this message: you will not hear from us.`,
    ctaLabel: 'Confirm subscription'
  })
}

/** A subscriber changes topics on their own preferences page, never from the public form. */
async function sendPreferencesLink(project: ParseObject, contact: ParseObject): Promise<void> {
  const email = String(contact.get('email') || '')
  if (!await addressMailAllowed(project, email)) return
  const { preferencesUrl } = unsubscribeLinks(publicBaseUrl(), project.id || '', contact.id || '')
  const name = String(contact.get('name') || '')
  const rendered = renderMessageEmail({ appName: String(project.get('name') || ''), senderName: String(project.get('name') || ''), recipientName: name, subject: `Your email preferences for ${project.get('name') || 'our newsletter'}`, body: `Someone asked to change which emails you get from ${project.get('name') || 'us'}. If it was you, pick your topics on your preferences page. If not, ignore this message: nothing has changed.`, ctaUrl: preferencesUrl, ctaLabel: 'Choose your topics', attachmentUrls: [] })
  await deliverEmails([{
    project,
    to: { email, name },
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    sender: marketingSender(project),
    log: { source: 'system', kind: 'message', template: null, templateKey: '', templateName: 'Email preferences', variables: { preferencesUrl }, batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
  }])
}

/** Whether a form's topic choice differs from the contact's opt-outs; only the project's current topics count. */
export function topicChoiceDiffers(topics: string[], current: string[], wanted: string[]): boolean {
  return topics.some(key => current.includes(key) !== wanted.includes(key))
}

/** Take a sign-up. Never says whether the address was already there. */
/** The workspace is at its contact limit: the visitor gets a plain answer, not the details of someone's plan. */
function closedAtLimit(error: { statusCode?: number }): never {
  throw error.statusCode === 402 ? createError({ statusCode: 402, statusMessage: SIGNUPS_CLOSED }) : error
}

export async function handleSignup(event: H3Event, project: ParseObject, input: SignupInput): Promise<{ pending: boolean }> {
  const marketing = normalizeMarketingConfig(project.get('marketing'))
  if (input.bot) return { pending: marketing.doubleOptIn }
  const ip = clientIp(event) || ''
  await rateLimit(`sb:rl:signup:${ip || 'ip'}`, LIMITS.signupsPerIp.limit, LIMITS.signupsPerIp.window)
  await rateLimit(`sb:rl:signup:p:${project.id}`, LIMITS.signupsPerProject.limit, LIMITS.signupsPerProject.window)
  const consent = { ip, ua: String(getHeader(event, 'user-agent') || '').slice(0, 300), formUrl: String(getHeader(event, 'referer') || getHeader(event, 'origin') || '').slice(0, 300) }
  const unsubscribedTopics = input.topics ? marketing.topics.map(t => t.key).filter(k => !input.topics!.includes(k)) : undefined

  // At the contact limit the form closes for everyone alike, so its answer never tells who is already a contact.
  await checkGauge(await projectWorkspaceId(project), 'contacts').catch(closedAtLimit)
  const existing = await findContactBy(project, { email: input.email })
  if (existing?.get('subscription') === 'subscribed') {
    // Already in. Anyone can type an address in here, so a different topic
    // choice is not applied: the subscriber gets their preferences link.
    const current = (existing.get('unsubscribedTopics') as string[] | undefined) || []
    if (unsubscribedTopics && topicChoiceDiffers(marketing.topics.map(t => t.key), current, unsubscribedTopics)) {
      void sendPreferencesLink(project, existing).catch(error => console.error('[signup] preferences link failed:', (error as Error).message))
    }
    // The same answer as for anyone new.
    return { pending: marketing.doubleOptIn }
  }
  // Anyone can type an address into this form, so someone who unsubscribed
  // comes back only through the confirmation mail, double opt-in or not.
  const confirm = marketing.doubleOptIn || existing?.get('subscription') === 'unsubscribed'
  const [result] = await upsertContacts(project, [{ email: input.email, ...(input.name ? { name: input.name } : {}), subscription: confirm ? 'pending' : 'subscribed', ...(unsubscribedTopics ? { unsubscribedTopics } : {}) }], { via: 'form', explicit: true, fillOnly: true, consent })
    .catch(closedAtLimit)
  if (result?.status !== 'failed' && confirm) {
    const contact = await findContactBy(project, { email: input.email })
    if (contact) await sendConfirmation(project, contact)
  }
  return { pending: marketing.doubleOptIn }
}

/** The click in the confirmation email (a POST from the confirm page). */
export async function confirmSignup(event: H3Event, token: string): Promise<ParseObject | null> {
  const link = readConfirmToken(token)
  if (!link) return null
  const project = await loadProjectUnscoped(link.projectId).catch(() => null)
  if (!project) return null
  const contact = await new (useParse()).Query('EndUser').equalTo('project', project).equalTo('objectId', link.contactId).first(MASTER)
  if (!contact) return null
  if (contact.get('subscription') === 'pending') {
    const consent = { ...(contact.get('consent') || {}), confirmedAt: new Date().toISOString(), ip: clientIp(event) || '' }
    await saveContact(project, contact, { subscription: 'subscribed' }, { via: 'form', explicit: true, consent })
  }
  return project
}

// ---- pages ---------------------------------------------------------------------

export function signupPage(project: ParseObject, options: { sent?: boolean, error?: string, poweredBy?: PoweredBy | null } = {}): string {
  const brand = pageBrand(project, options.poweredBy)
  const marketing = normalizeMarketingConfig(project.get('marketing'))
  if (options.sent) {
    return renderMarketingPage(brand, 'Almost there', marketing.doubleOptIn
      ? '<h1>Check your inbox</h1><p>We sent you a link to confirm your subscription. It works for seven days.</p>'
      : '<h1>You are subscribed</h1><p>Thanks for signing up.</p>')
  }
  const topics = marketing.topics.length
    ? `<input type="hidden" name="topics_sent" value="1"><fieldset>${marketing.topics.map(t => `<label><input type="checkbox" name="topics" value="${escapeHtml(t.key)}" checked><span>${escapeHtml(t.name)}${t.description ? `<small>${escapeHtml(t.description)}</small>` : ''}</span></label>`).join('')}</fieldset>`
    : ''
  return renderMarketingPage(brand, 'Subscribe', `<h1>Get email from ${escapeHtml(brand.name)}</h1>
${options.error ? `<div class="note">${escapeHtml(options.error)}</div>` : ''}
<form method="post" action="/v1/subscribe">
<input type="hidden" name="pk" value="${escapeHtml(project.get('publicKey'))}">
<input type="email" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Email">
<input type="text" name="name" placeholder="Your name (optional)" autocomplete="name" aria-label="Name">
<div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
${topics}
<button type="submit">Subscribe</button>
</form>
<p style="margin-top:16px;font-size:13px">Unsubscribe any time with the link in every email.</p>`)
}

export function confirmPage(project: ParseObject, token: string, poweredBy: PoweredBy | null = null): string {
  return renderMarketingPage(pageBrand(project, poweredBy), 'Confirm', `<h1>Confirm your subscription</h1><p>One click and you are in.</p>
<form method="post" action="/u/confirm/${encodeURIComponent(token)}"><button type="submit">Confirm subscription</button></form>`)
}
