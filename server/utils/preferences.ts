import { getHeader, type H3Event } from 'h3'
import { normalizeMarketingConfig } from '#shared/marketing'
import type { ContactSubscription } from '#shared/contacts'
import type { PoweredBy } from './branding'
import { readUnsubscribePayload } from './campaigns'
import { saveContact } from './contacts'
import { escapeHtml } from './messageEmail'
import { pageBrand, renderMarketingPage } from './marketingPages'
import { MASTER, useParse, type ParseObject } from './parse'
import { loadProjectUnscoped } from './projects'
import { readLinkToken } from './secrets'
import { sendConfirmation } from './signup'

// The page every marketing email links to (/u/<token>): unsubscribe, pick
// topics, or subscribe again. The signed token names the project, the contact
// and — for a topic's campaign — the topic, so it needs no sign-in. It never
// expires (an unsubscribe link must keep working) and emails get forwarded, so
// subscribing again goes through the confirmation mail; leaving stays instant.

export type PreferenceLink = { project: ParseObject, contact: ParseObject, topic: string }

export async function loadPreferenceLink(token: string): Promise<PreferenceLink | null> {
  let payload: string | null = null
  try { payload = readLinkToken('unsubscribe', token) } catch { return null }
  const link = readUnsubscribePayload(payload)
  if (!link) return null
  const project = await loadProjectUnscoped(link.projectId).catch(() => null)
  if (!project) return null
  const contact = await new (useParse()).Query('EndUser').equalTo('project', project).equalTo('objectId', link.contactId).first(MASTER)
  return contact ? { project, contact, topic: link.topic } : null
}

const requestConsent = (event: H3Event) => ({ ip: clientIp(event) || '', ua: String(getHeader(event, 'user-agent') || '').slice(0, 300), formUrl: 'preferences page' })

/** The one-click path (RFC 8058) and the page's "Unsubscribe" button: the campaign's topic, or everything. */
export async function unsubscribeByLink(link: PreferenceLink, via: string): Promise<void> {
  const topics = normalizeMarketingConfig(link.project.get('marketing')).topics
  if (link.topic && topics.some(t => t.key === link.topic)) {
    const current = (link.contact.get('unsubscribedTopics') as string[] | undefined) || []
    await saveContact(link.project, link.contact, { unsubscribedTopics: [...new Set([...current, link.topic])] }, { via })
  } else {
    await saveContact(link.project, link.contact, { subscription: 'unsubscribed' }, { via })
  }
}

/** A form POST from the page. */
export async function applyPreferenceForm(event: H3Event, link: PreferenceLink, body: Record<string, unknown>): Promise<string> {
  const action = String(body.action || '')
  const topics = normalizeMarketingConfig(link.project.get('marketing')).topics
  if (action === 'unsubscribe') { await unsubscribeByLink(link, 'unsubscribe link'); return 'unsubscribed' }
  if (action === 'unsubscribe-all') { await saveContact(link.project, link.contact, { subscription: 'unsubscribed' }, { via: 'preferences page' }); return 'unsubscribed' }
  if (action === 'resubscribe') {
    if (link.contact.get('subscription') === 'subscribed') return ''
    await saveContact(link.project, link.contact, { subscription: 'pending' }, { via: 'preferences page', explicit: true, consent: requestConsent(event) })
    await sendConfirmation(link.project, link.contact)
    return 'confirm'
  }
  if (action === 'save') {
    const off = topics.filter(t => body[`topic_${t.key}`] === undefined).map(t => t.key)
    await saveContact(link.project, link.contact, { unsubscribedTopics: off }, { via: 'preferences page' })
    return 'saved'
  }
  return ''
}

const NOTICES: Record<string, string> = {
  unsubscribed: 'Done. You will not get these emails any more.',
  confirm: 'Check your inbox: we sent you a link to confirm your subscription. It works for seven days.',
  saved: 'Your choices are saved.'
}

export function renderPreferencesPage(link: PreferenceLink, options: { token: string, askUnsubscribe: boolean, notice: string, poweredBy?: PoweredBy | null }): string {
  const brand = pageBrand(link.project, options.poweredBy)
  const marketing = normalizeMarketingConfig(link.project.get('marketing'))
  const subscription = (link.contact.get('subscription') as ContactSubscription) || 'none'
  const off = new Set((link.contact.get('unsubscribedTopics') as string[] | undefined) || [])
  const email = escapeHtml(link.contact.get('email') || '')
  const action = `/u/${encodeURIComponent(options.token)}`
  const notice = NOTICES[options.notice] ? `<div class="note">${escapeHtml(NOTICES[options.notice])}</div>` : ''
  const topic = marketing.topics.find(t => t.key === link.topic)

  if (subscription === 'unsubscribed') {
    return renderMarketingPage(brand, 'Unsubscribed', `${notice}<h1>You are unsubscribed</h1>
<p>${email} gets no marketing email from ${escapeHtml(brand.name)}. Account and security emails still arrive.</p>
<form method="post" action="${action}"><input type="hidden" name="action" value="resubscribe"><button class="quiet" type="submit">Subscribe again</button></form>`)
  }

  const ask = options.askUnsubscribe && !options.notice
    ? `<h1>Unsubscribe from ${escapeHtml(topic ? topic.name : `${brand.name} emails`)}?</h1>
<p>${email} will stop getting ${topic ? 'these' : 'marketing'} emails.</p>
<form method="post" action="${action}"><input type="hidden" name="action" value="unsubscribe"><button type="submit">Unsubscribe</button></form>
<p style="margin-top:20px">Or choose what you get:</p>`
    : `${notice}<h1>Email preferences</h1><p>For ${email}.</p>`

  const topicForm = marketing.topics.length
    ? `<form method="post" action="${action}"><input type="hidden" name="action" value="save"><fieldset>${marketing.topics.map(t => `<label><input type="checkbox" name="topic_${escapeHtml(t.key)}"${off.has(t.key) ? '' : ' checked'}><span>${escapeHtml(t.name)}${t.description ? `<small>${escapeHtml(t.description)}</small>` : ''}</span></label>`).join('')}</fieldset><button type="submit">Save</button></form>`
    : ''
  const all = `<form method="post" action="${action}"><input type="hidden" name="action" value="unsubscribe-all"><button class="quiet" type="submit">Unsubscribe from all ${escapeHtml(brand.name)} emails</button></form>`
  return renderMarketingPage(brand, 'Email preferences', ask + topicForm + all)
}
