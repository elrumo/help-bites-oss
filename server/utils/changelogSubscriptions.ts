import { createError } from 'h3'
import {
  CHANGELOG_IMPORT_SUBSCRIPTIONS_MAX,
  changelogCopy,
  fillChangelogTokenUrl,
  isSubscriberEmail,
  normalizeSubscriberEmail,
  readChangelogRunImportItem,
  readChangelogSubscriptionImportItem,
  type ChangelogFrequency
} from '#shared/changelog'
import { changelogConfirmVariables } from './changelogDigest'
import { sendChangelogTemplate } from './changelogMail'
import { loadProjectUnscoped } from './projects'
import { CHANGELOG_LINK_SECRET_REQUIRED, changelogLinkSecret, createChangelogToken, verifyChangelogToken } from './changelogTokens'

// Who gets emailed about the changelog, and how often.
//
// One class for everyone, signed-in users and anonymous addresses alike: the
// changelog has a single flat audience, and a row keyed by email (sometimes
// claimed by a user id) keeps the send query and the token target uniform.
//
// Anonymous addresses are double opt-in: a row starts `pending` and only a
// click on the emailed confirm link activates it. A signed-in subscribe
// activates immediately (their account already proves the mailbox). Unsubscribed
// rows are kept: they are the suppression record, and subscribing again reuses
// the row instead of growing a graveyard of duplicates.

/** The send keys of the project's two email templates (see the docs). */
export const CHANGELOG_CONFIRM_TEMPLATE = 'changelog-confirm'

/** Resend the confirm mail at most once a day per address. */
const CONFIRM_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000
/** Confirm mails per project per hour: a form this public needs a ceiling. */
const CONFIRM_HOURLY_LIMIT = 30

export function changelogNotifyEnabled(project: ParseObject): boolean {
  return getChangelogConfig(project).notify
}

/** Subscriptions need the project to have them on, the link secret to sign with and an address for the links. */
export function requireChangelogNotify(project: ParseObject): void {
  if (!changelogNotifyEnabled(project)) throw createError({ statusCode: 404, statusMessage: 'This changelog has no notifications' })
  if (!changelogLinkSecret()) throw createError({ statusCode: 503, statusMessage: CHANGELOG_LINK_SECRET_REQUIRED })
  const config = getChangelogConfig(project)
  if ((!config.confirmUrl || !config.unsubscribeUrl) && !appBase()) throw createError({ statusCode: 503, statusMessage: 'Set APP_URL on the server: changelog confirm and unsubscribe links need a public address' })
}

function siteUrlOf(project: ParseObject): string {
  return String(project.get('siteUrl') || '')
}

function appBase(): string {
  return String(process.env.APP_URL || '').trim().replace(/\/+$/, '')
}

/** The project's own page when it set one, else the hosted page on this server (`/u/changelog/…`). */
function linkUrl(project: ParseObject, template: string, purpose: 'confirm' | 'unsubscribe', subscriptionId: string): string {
  const token = createChangelogToken(purpose === 'confirm' ? 'confirm' : 'unsub', subscriptionId)
  if (template) return fillChangelogTokenUrl(template, siteUrlOf(project), token)
  return `${appBase()}/u/changelog/${purpose}/${encodeURIComponent(token)}`
}

export function changelogConfirmUrl(project: ParseObject, subscriptionId: string): string {
  return linkUrl(project, getChangelogConfig(project).confirmUrl, 'confirm', subscriptionId)
}

export function changelogUnsubscribeUrl(project: ParseObject, subscriptionId: string): string {
  return linkUrl(project, getChangelogConfig(project).unsubscribeUrl, 'unsubscribe', subscriptionId)
}

/**
 * The RFC 8058 one-click target. Mail providers POST it directly, with no page
 * and no script, so it is this server's own route and not the project's site.
 */
export function changelogOneClickUnsubscribeUrl(subscriptionId: string): string {
  return `${appBase()}/v1/changelog/subscribe/unsubscribe?token=${encodeURIComponent(createChangelogToken('unsub', subscriptionId))}`
}

/** The project a hosted link page is for, to brand it; null for a link that is forged, expired or for a vanished row. */
export async function changelogLinkProject(token: string, purpose: 'confirm' | 'unsub'): Promise<ParseObject | null> {
  const result = verifyChangelogToken(token)
  if (!result.valid || result.purpose !== purpose) return null
  const row = await findSubscriptionById(result.subscriptionId)
  const project = row?.get('project') as ParseObject | undefined
  return project ? await loadProjectUnscoped(project.id || '').catch(() => null) : null
}

function newSubscription(project: ParseObject, email: string): ParseObject {
  const row = new (useParse().Object.extend('ChangelogSubscription'))() as ParseObject
  row.set('project', project)
  row.set('email', email)
  return row
}

async function findSubscriptionByEmail(project: ParseObject, email: string): Promise<ParseObject | undefined> {
  return await new (useParse()).Query('ChangelogSubscription').equalTo('project', project).equalTo('email', email).first(MASTER)
}

/** A subscription by its id, or by the id it had in the system it was imported from (`parse:<id>`), so links sent from there still work. */
async function findSubscriptionById(id: string): Promise<ParseObject | undefined> {
  const Parse = useParse()
  const byId = await new Parse.Query('ChangelogSubscription').equalTo('objectId', id).first(MASTER)
  return byId || await new Parse.Query('ChangelogSubscription').equalTo('externalId', `parse:${id}`).first(MASTER)
}

/** A greeting-safe name: a handle that is really an email address is dropped. */
function safeName(value: unknown): string {
  const name = String(value ?? '').trim()
  return name && !name.includes('@') ? name.slice(0, 120) : ''
}

export type SubscriptionState = { state: 'active' | 'unsubscribed', frequency: ChangelogFrequency | null }

/**
 * Signed-in subscribe: the account's email is the address, whatever the body
 * claimed. Activates immediately and claims an anonymous row already holding
 * the same mailbox.
 */
export async function subscribeSignedIn(project: ParseObject, claims: IdentityClaims, frequency: ChangelogFrequency | 'off'): Promise<SubscriptionState> {
  const email = normalizeSubscriberEmail(claims.email)
  if (!isSubscriberEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Your account has no email address to notify' })

  const row = await findSubscriptionByEmail(project, email) || newSubscription(project, email)
  row.set('userId', claims.sub)
  row.set('displayName', safeName(claims.name))
  row.set('source', 'user')
  if (frequency === 'off') {
    row.set('status', 'unsubscribed')
    row.set('unsubscribedAt', new Date())
    await row.save(null, MASTER)
    return { state: 'unsubscribed', frequency: null }
  }
  row.set('frequency', frequency)
  row.unset('pendingFrequency')
  row.set('status', 'active')
  if (!row.get('confirmedAt')) row.set('confirmedAt', new Date())
  row.unset('unsubscribedAt')
  await row.save(null, MASTER)
  return { state: 'active', frequency }
}

/**
 * Anonymous subscribe. The chosen cadence lands in `pendingFrequency` and only
 * the confirm click applies it: an already-active row must not be retunable by
 * anyone who happens to know the address. The caller always gets the same
 * answer, so this is not an oracle for whether an address is subscribed.
 */
export async function subscribeAnonymous(project: ParseObject, rawEmail: string, frequency: ChangelogFrequency): Promise<void> {
  const email = normalizeSubscriberEmail(rawEmail)
  if (!isSubscriberEmail(email)) throw createError({ statusCode: 400, statusMessage: 'A valid email is required' })

  const existing = await findSubscriptionByEmail(project, email)
  const row = existing || newSubscription(project, email)
  row.set('pendingFrequency', frequency)
  if (row.get('status') !== 'active') {
    row.set('status', 'pending')
    if (!existing) row.set('source', 'anonymous')
  }

  // Silent throttle: a repeat inside the window saves the new choice but sends no second mail, and does not say so.
  const lastSent = row.get('confirmSentAt') as Date | undefined
  const shouldSend = !lastSent || Date.now() - lastSent.getTime() > CONFIRM_RESEND_WINDOW_MS
  if (shouldSend) {
    const recent = await new (useParse()).Query('ChangelogSubscription').equalTo('project', project).greaterThan('confirmSentAt', new Date(Date.now() - 60 * 60 * 1000)).count(MASTER)
    if (recent >= CONFIRM_HOURLY_LIMIT) throw createError({ statusCode: 429, statusMessage: 'Too many subscription requests right now, try again in a bit' })
    row.set('confirmSentAt', new Date())
  }
  await row.save(null, MASTER)

  if (shouldSend) {
    // Losing the mail loses nothing durable: the next submit resends it.
    await sendChangelogTemplate(project, {
      template: CHANGELOG_CONFIRM_TEMPLATE,
      to: [{ email }],
      variables: changelogConfirmVariables({ confirmUrl: changelogConfirmUrl(project, row.id || ''), frequency, copy: changelogCopy(getChangelogConfig(project)) }),
      tags: ['changelog-confirm']
    }).catch((error) => { console.error('[changelog] confirm email failed:', (error as Error).message) })
  }
}

export async function confirmChangelogSubscription(token: string): Promise<{ frequency: ChangelogFrequency }> {
  const invalid = () => createError({ statusCode: 400, statusMessage: 'This confirmation link is invalid or has expired' })
  const result = verifyChangelogToken(token)
  if (!result.valid || result.purpose !== 'confirm') throw invalid()
  const row = await findSubscriptionById(result.subscriptionId)
  // An unsubscribe outranks a confirm link still sitting in an inbox: coming back takes a new subscribe, and a new link.
  if (!row || row.get('status') === 'unsubscribed') throw invalid()

  const frequency = (row.get('pendingFrequency') || row.get('frequency') || 'instant') as ChangelogFrequency
  row.set('frequency', frequency)
  row.unset('pendingFrequency')
  row.set('status', 'active')
  row.unset('unsubscribedAt')
  if (!row.get('confirmedAt')) row.set('confirmedAt', new Date())
  await row.save(null, MASTER)
  return { frequency }
}

export async function unsubscribeChangelogByToken(token: string): Promise<void> {
  const result = verifyChangelogToken(token)
  if (!result.valid || result.purpose !== 'unsub') throw createError({ statusCode: 400, statusMessage: 'This unsubscribe link is invalid' })
  const row = await findSubscriptionById(result.subscriptionId)
  // A vanished row means nothing is subscribed: that is a success.
  if (!row || row.get('status') === 'unsubscribed') return
  row.set('status', 'unsubscribed')
  row.set('unsubscribedAt', new Date())
  await row.save(null, MASTER)
}

/** The signed-in user's current cadence, matched by their id or their account email. */
export async function getChangelogSubscription(project: ParseObject, claims: IdentityClaims): Promise<{ frequency: ChangelogFrequency | null }> {
  const Parse = useParse()
  let row = await new Parse.Query('ChangelogSubscription').equalTo('project', project).equalTo('userId', claims.sub).first(MASTER)
  const email = normalizeSubscriberEmail(claims.email)
  if (!row && email) row = await findSubscriptionByEmail(project, email)
  if (!row || row.get('status') !== 'active') return { frequency: null }
  return { frequency: (row.get('frequency') as ChangelogFrequency | undefined) || null }
}

export type ActiveRecipient = { subscriptionId: string, email: string, name: string | null }

export async function countChangelogSubscribers(project: ParseObject): Promise<Record<string, number>> {
  const Parse = useParse()
  const count = (status: string, frequency?: string) => {
    const query = new Parse.Query('ChangelogSubscription').equalTo('project', project).equalTo('status', status)
    if (frequency) query.equalTo('frequency', frequency)
    return query.count(MASTER)
  }
  const [instant, weekly, pending, unsubscribed] = await Promise.all([count('active', 'instant'), count('active', 'weekly'), count('pending'), count('unsubscribed')])
  return { instant, weekly, pending, unsubscribed }
}

export type ChangelogSubscriptionImportResult = {
  results: { index: number, id: string, externalId: string, created: boolean }[]
  failed: { index: number, message: string }[]
  runs: number
}

/**
 * Bring subscribers over from another system (up to 500; `subscriptions`, and
 * `runs`, the past sends, so the first weekly sweep does not repeat one). A
 * subscription whose `externalId` (or, failing that, email) exists is updated,
 * except that one already unsubscribed here is never reactivated. Unsubscribed
 * ones come over as the suppression record they are. No mail.
 */
export async function importChangelogSubscriptions(project: ParseObject, payload: unknown): Promise<ChangelogSubscriptionImportResult> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const items = Array.isArray(raw.subscriptions) ? raw.subscriptions : []
  const runs = Array.isArray(raw.runs) ? raw.runs : []
  if (!items.length && !runs.length) throw createError({ statusCode: 400, statusMessage: 'Send subscriptions and/or runs' })
  if (items.length > CHANGELOG_IMPORT_SUBSCRIPTIONS_MAX) throw createError({ statusCode: 400, statusMessage: `subscriptions holds at most ${CHANGELOG_IMPORT_SUBSCRIPTIONS_MAX}` })
  const Parse = useParse()
  const out: ChangelogSubscriptionImportResult = { results: [], failed: [], runs: 0 }

  for (const [index, item] of items.entries()) {
    try {
      const { values, errors } = readChangelogSubscriptionImportItem(item)
      if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
      const existing = await new Parse.Query('ChangelogSubscription').equalTo('project', project).equalTo('externalId', values.externalId).first(MASTER) || await findSubscriptionByEmail(project, values.email)
      const row = existing || newSubscription(project, values.email)
      row.set('externalId', values.externalId)
      row.set('email', values.email)
      row.set('userId', values.userId)
      row.set('displayName', safeName(values.displayName))
      // Consent is not history's to give back: a person who unsubscribed here stays unsubscribed,
      // however stale the copy being imported is, so re-running an import can never mail them again.
      if (existing?.get('status') !== 'unsubscribed') {
        row.set('frequency', values.frequency)
        values.pendingFrequency ? row.set('pendingFrequency', values.pendingFrequency) : row.unset('pendingFrequency')
        row.set('status', values.status)
        row.set('source', values.source)
        for (const [key, date] of [['confirmedAt', values.confirmedAt], ['unsubscribedAt', values.unsubscribedAt], ['confirmSentAt', values.confirmSentAt]] as const) {
          date ? row.set(key, date) : row.unset(key)
        }
      }
      await row.save(null, MASTER)
      out.results.push({ index, id: row.id || '', externalId: values.externalId, created: !existing })
    } catch (error) {
      out.failed.push({ index, message: String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Could not import the subscription') })
    }
  }

  for (const item of runs) {
    const { values, errors } = readChangelogRunImportItem(item)
    if (errors.length) continue
    const existing = values.windowEnd ? await new Parse.Query('ChangelogNotifyRun').equalTo('project', project).equalTo('kind', values.kind).equalTo('windowEnd', values.windowEnd).first(MASTER) : undefined
    if (existing) continue
    const run = new (Parse.Object.extend('ChangelogNotifyRun'))() as ParseObject
    run.set('project', project)
    run.set('kind', values.kind)
    run.set('status', 'sent')
    run.set('imported', true)
    run.set('entryIds', [])
    if (values.windowStart) run.set('windowStart', values.windowStart)
    if (values.windowEnd) run.set('windowEnd', values.windowEnd)
    run.set('startedAt', values.finishedAt || new Date())
    run.set('finishedAt', values.finishedAt || new Date())
    run.set('recipientCount', 0)
    await run.save(null, MASTER)
    out.runs += 1
  }
  return out
}

/**
 * Delete a person's subscriptions (their account is being erased): the rows
 * their user id claimed and the ones they made by address alone, signed out or
 * before they had an account. A page at a time until none are left.
 */
export async function eraseChangelogSubscriptions(project: ParseObject, who: { externalId?: string, emails?: string[] }): Promise<number> {
  const Parse = useParse()
  const emails = [...new Set((who.emails || []).map(normalizeSubscriberEmail).filter(Boolean))]
  const queries = [
    who.externalId ? new Parse.Query('ChangelogSubscription').equalTo('project', project).equalTo('userId', who.externalId) : null,
    emails.length ? new Parse.Query('ChangelogSubscription').equalTo('project', project).containedIn('email', emails) : null
  ].filter(query => query !== null)
  if (!queries.length) return 0
  let erased = 0
  for (;;) {
    const rows = await Parse.Query.or(...queries).limit(500).find(MASTER)
    if (rows.length) await Parse.Object.destroyAll(rows, MASTER)
    erased += rows.length
    if (rows.length < 500) return erased
  }
}
