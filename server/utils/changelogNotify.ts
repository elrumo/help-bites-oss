import { createHash } from 'node:crypto'
import { changelogCopy, fillChangelogUrl, type ChangelogFrequency } from '#shared/changelog'
import { changelogDigestVariables, greetingFirstName, shouldFlushPending, weeklyWindowFor, weeklyWindowLabel, type ChangelogEmailEntry } from './changelogDigest'
import { sendChangelogTemplate } from './changelogMail'
import { changelogOneClickUnsubscribeUrl, changelogUnsubscribeUrl, requireChangelogNotify, type ActiveRecipient } from './changelogSubscriptions'
import { changelogLinkSecret } from './changelogTokens'

// The changelog's notification runners: an instant sweep with a trailing
// debounce and a weekly digest, per project that has `changelog.notify` on.
//
// A publish is detected by an explicit mark, `notifyPendingSince`, stamped at
// the publish transitions (see changelog.ts), not by `publishedAt` (which can
// be backdated) or `updatedAt` (which a comment count moves). The sweep is the
// only sender, so a CLI batch, an admin publish and a draft approval all flow
// through the same debounce and land in the same email.
//
// Delivery is at-most-once by design: a run interrupted mid-send is abandoned
// and its entries marked notified WITHOUT resending. A lost release note is an
// annoyance; the same note delivered twice to every subscriber is a reputation
// problem. For the same reason one process at a time sends for a project (a
// Redis lock), and subscribers are read and mailed a page at a time.

export const CHANGELOG_DIGEST_TEMPLATE = 'changelog'

/** Entries published longer ago than this are old news, not notifications. */
const BACKFILL_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000
/** A run `sending` for longer than this is a crashed run, not a slow one. */
const STUCK_RUN_MS = 15 * 60 * 1000
/** A mail send takes at most 50 recipients. */
const SEND_BATCH_SIZE = 50
/** Subscribers are read, and mailed, this many at a time. */
const RECIPIENT_PAGE_SIZE = 500

// ---- delivery -----------------------------------------------------------------

function toEmailEntry(row: ParseObject): ChangelogEmailEntry {
  return {
    slug: changelogEntrySlug(row),
    title: String(row.get('title') || 'A change'),
    summary: String(row.get('summary') || '') || null,
    excerpt: String(row.get('excerpt') || '') || null,
    tag: String(row.get('tag') || '') || null
  }
}

/**
 * Send the `changelog` template in batches of 50. Each subscriber gets their
 * own message with their own unsubscribe links; a batch the provider refuses is
 * logged and skipped instead of ending the run. Returns how many went out
 * (bounced or complained addresses come back suppressed and do not count).
 */
export async function deliverChangelogDigest(project: ParseObject, recipients: ActiveRecipient[], entries: ChangelogEmailEntry[], kind: ChangelogFrequency, windowLabel?: string): Promise<number> {
  const config = getChangelogConfig(project)
  const siteUrl = String(project.get('siteUrl') || '').replace(/\/+$/, '')
  const variables = changelogDigestVariables({
    entries,
    copy: changelogCopy(config),
    siteName: config.siteName || String(project.get('name') || 'the changelog'),
    entryUrl: slug => fillChangelogUrl(config.entryUrl, siteUrl, slug),
    pageUrl: config.pageUrl.replace('{siteUrl}', siteUrl),
    kind,
    windowLabel
  })
  const slugs = entries.map(entry => entry.slug).join(',')
  let delivered = 0

  for (let start = 0; start < recipients.length; start += SEND_BATCH_SIZE) {
    const batch = recipients.slice(start, start + SEND_BATCH_SIZE)
    try {
      const summary = await sendChangelogTemplate(project, {
        template: CHANGELOG_DIGEST_TEMPLATE,
        to: batch.map(recipient => ({
          email: recipient.email,
          variables: {
            firstName: greetingFirstName(recipient.name),
            unsubscribeUrl: changelogUnsubscribeUrl(project, recipient.subscriptionId),
            oneClickUnsubscribeUrl: changelogOneClickUnsubscribeUrl(recipient.subscriptionId)
          }
        })),
        variables,
        headers: { 'List-Unsubscribe': '<{{oneClickUnsubscribeUrl}}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        // Two ticks (or two instances) sending the same batch collapse into one send.
        idempotencyKey: `changelog-${kind}-${createHash('sha256').update(`${slugs}|${batch.map(recipient => recipient.email).join(',')}`).digest('hex').slice(0, 32)}`,
        tags: ['changelog', `changelog-${kind}`]
      })
      delivered += summary.sent
    } catch (error) {
      console.error(`[changelog] ${kind} batch of ${batch.length} failed:`, (error as Error).message)
    }
  }
  return delivered
}

/** Everyone active at a cadence, a page at a time, so a big list is never all in memory. */
async function eachRecipientPage(project: ParseObject, frequency: ChangelogFrequency, fn: (recipients: ActiveRecipient[]) => Promise<void>): Promise<void> {
  await eachBatch(() => new (useParse()).Query('ChangelogSubscription').equalTo('project', project).equalTo('status', 'active').equalTo('frequency', frequency), async (rows) => {
    const recipients = rows.flatMap((row) => {
      const email = String(row.get('email') || '')
      return email ? [{ subscriptionId: row.id || '', email, name: String(row.get('displayName') || '') || null }] : []
    })
    if (recipients.length) await fn(recipients)
  }, { batchSize: RECIPIENT_PAGE_SIZE, keys: ['email', 'displayName'] })
}

async function countRecipients(project: ParseObject, frequency: ChangelogFrequency): Promise<number> {
  let count = 0
  await eachRecipientPage(project, frequency, async (recipients) => { count += recipients.length })
  return count
}

/** The digest to everyone active at its cadence, page by page. Returns how many went out. */
async function deliverToSubscribers(project: ParseObject, entries: ChangelogEmailEntry[], kind: ChangelogFrequency, windowLabel?: string): Promise<number> {
  let delivered = 0
  await eachRecipientPage(project, kind, async (recipients) => { delivered += await deliverChangelogDigest(project, recipients, entries, kind, windowLabel) })
  return delivered
}

/**
 * One sender per project at a time, across processes: the tick on two
 * workers, or the tick and the run-now route, would mail the same release
 * twice. Held as long as a run may take before it counts as crashed; `busy`
 * is the answer while another holds it. Without Redis the scheduler never
 * ticks, so only the run-now route gets here, and it runs as before.
 */
async function oneSenderAtATime<T>(project: ParseObject, busy: T, run: () => Promise<T>): Promise<T> {
  const held = await runExclusive(`sb:changelog:notify:${project.id}`, STUCK_RUN_MS / 1000, run, { failOpen: true })
  return held.ran ? held.value : busy
}

// ---- the ledger and the marks -----------------------------------------------------

function newRun(project: ParseObject, kind: ChangelogFrequency): ParseObject {
  const run = new (useParse().Object.extend('ChangelogNotifyRun'))() as ParseObject
  run.set('project', project)
  run.set('kind', kind)
  run.set('startedAt', new Date())
  return run
}

async function markEntriesNotified(entryIds: string[]): Promise<void> {
  if (!entryIds.length) return
  const Parse = useParse()
  const rows = await new Parse.Query('ChangelogEntry').containedIn('objectId', entryIds).doesNotExist('notifiedAt').limit(entryIds.length).find(MASTER)
  for (const row of rows) row.set('notifiedAt', new Date())
  if (rows.length) await Parse.Object.saveAll(rows, MASTER)
}

/** A run that crashed mid-send: abandoned, and its entries marked notified WITHOUT resending (some recipients already have the mail). */
async function reapStuckRuns(project: ParseObject): Promise<void> {
  const rows = await new (useParse()).Query('ChangelogNotifyRun').equalTo('project', project).equalTo('status', 'sending').lessThan('startedAt', new Date(Date.now() - STUCK_RUN_MS)).find(MASTER)
  for (const run of rows) {
    await markEntriesNotified((run.get('entryIds') as string[]) || [])
    run.set('status', 'abandoned')
    run.set('finishedAt', new Date())
    await run.save(null, MASTER)
  }
}

/** Entries whose release is still a draft are not public yet, so not news yet. */
async function onlyPublic(rows: ParseObject[]): Promise<ParseObject[]> {
  const releaseIds = [...new Set(rows.map(row => pointerId(row.get('release'))).filter(Boolean))]
  if (!releaseIds.length) return rows
  const published = new Set((await new (useParse()).Query('ChangelogRelease').containedIn('objectId', releaseIds).equalTo('status', 'published').select('objectId').limit(releaseIds.length).find(MASTER)).map(release => release.id))
  return rows.filter(row => { const id = pointerId(row.get('release')); return !id || published.has(id) })
}

// ---- the instant sweep -------------------------------------------------------------

export type InstantSweepResult = { flushed: boolean, entries: number, recipients: number }

export async function runChangelogInstantSweep(project: ParseObject, now: Date = new Date(), options: { dryRun?: boolean } = {}): Promise<InstantSweepResult> {
  if (options.dryRun) return await instantSweep(project, now, options)
  return await oneSenderAtATime(project, { flushed: false, entries: 0, recipients: 0 }, () => instantSweep(project, now, options))
}

async function instantSweep(project: ParseObject, now: Date, options: { dryRun?: boolean }): Promise<InstantSweepResult> {
  if (!options.dryRun) await reapStuckRuns(project)
  const config = getChangelogConfig(project)

  const pending = await onlyPublic(await new (useParse()).Query('ChangelogEntry').equalTo('project', project).exists('notifyPendingSince').doesNotExist('notifiedAt')
    .equalTo('status', 'published') // re-checked: an entry archived while pending must not mail
    .ascending('publishedAt').limit(100).find(MASTER))
  if (!pending.length) return { flushed: false, entries: 0, recipients: 0 }

  // Backdated entries are history, not news.
  const stale = pending.filter((row) => { const at = row.get('publishedAt') as Date | undefined; return at && now.getTime() - at.getTime() > BACKFILL_CUTOFF_MS })
  const fresh = pending.filter(row => !stale.includes(row))
  if (stale.length && !options.dryRun) await markEntriesNotified(stale.map(row => row.id || ''))
  if (!fresh.length) return { flushed: false, entries: 0, recipients: 0 }

  const times = fresh.map(row => row.get('notifyPendingSince') as Date | undefined).filter((time): time is Date => Boolean(time))
  if (!shouldFlushPending(times, now, config.digest.quietMinutes * 60_000, config.digest.maxWaitMinutes * 60_000)) return { flushed: false, entries: fresh.length, recipients: 0 }

  const entryIds = fresh.map(row => row.id || '')
  if (options.dryRun) return { flushed: true, entries: fresh.length, recipients: await countRecipients(project, 'instant') }

  const run = newRun(project, 'instant')
  run.set('status', 'sending')
  run.set('entryIds', entryIds)
  await run.save(null, MASTER)
  const delivered = await deliverToSubscribers(project, fresh.map(toEmailEntry), 'instant')
  await markEntriesNotified(entryIds)
  run.set('status', 'sent')
  run.set('recipientCount', delivered)
  run.set('finishedAt', new Date())
  await run.save(null, MASTER)
  return { flushed: true, entries: fresh.length, recipients: delivered }
}

// ---- the weekly digest -------------------------------------------------------------

export type WeeklyRunResult = { due: boolean, sent: boolean, entries: number, recipients: number }

async function alreadyRanThisWeek(project: ParseObject, windowEnd: Date): Promise<boolean> {
  return Boolean(await new (useParse()).Query('ChangelogNotifyRun').equalTo('project', project).equalTo('kind', 'weekly').equalTo('status', 'sent').greaterThanOrEqualTo('windowEnd', windowEnd).first(MASTER))
}

export async function runChangelogWeeklyDigest(project: ParseObject, now: Date = new Date(), options: { dryRun?: boolean } = {}): Promise<WeeklyRunResult> {
  if (options.dryRun) return await weeklyDigest(project, now, options)
  const { timezone, weeklyHour } = getChangelogConfig(project).digest
  const due = weeklyWindowFor(now, timezone, weeklyHour).due
  return await oneSenderAtATime(project, { due, sent: false, entries: 0, recipients: 0 }, () => weeklyDigest(project, now, options))
}

async function weeklyDigest(project: ParseObject, now: Date, options: { dryRun?: boolean }): Promise<WeeklyRunResult> {
  const { timezone, weeklyHour } = getChangelogConfig(project).digest
  const window = weeklyWindowFor(now, timezone, weeklyHour)
  const result: WeeklyRunResult = { due: window.due, sent: false, entries: 0, recipients: 0 }
  if (!window.due || await alreadyRanThisWeek(project, window.windowEnd)) return result

  const entries = await onlyPublic(await new (useParse()).Query('ChangelogEntry').equalTo('project', project).equalTo('status', 'published')
    .greaterThanOrEqualTo('publishedAt', window.windowStart).lessThan('publishedAt', window.windowEnd).descending('publishedAt').limit(100).find(MASTER))
  result.entries = entries.length
  if (options.dryRun) return { ...result, sent: entries.length > 0, recipients: entries.length ? await countRecipients(project, 'weekly') : 0 }

  const run = newRun(project, 'weekly')
  run.set('status', 'sending')
  run.set('entryIds', entries.map(row => row.id || ''))
  run.set('windowStart', window.windowStart)
  run.set('windowEnd', window.windowEnd)
  await run.save(null, MASTER)
  // An empty week sends nothing, but the ledger row still lands, so the check stops coming up due for the rest of the week.
  const delivered = entries.length ? await deliverToSubscribers(project, entries.map(toEmailEntry), 'weekly', weeklyWindowLabel(window, timezone)) : 0
  run.set('status', 'sent')
  run.set('recipientCount', delivered)
  run.set('finishedAt', new Date())
  await run.save(null, MASTER)
  return { ...result, sent: entries.length > 0, recipients: delivered }
}

// ---- the tick ----------------------------------------------------------------------

let ticking = false

/**
 * One scheduler beat for every project with notifications on: the instant
 * sweep, then the weekly check. Reentrancy-guarded (a slow mail provider must
 * not stack ticks) and never throws.
 */
export async function runChangelogTick(now: Date = new Date()): Promise<void> {
  if (ticking || !changelogLinkSecret()) return
  ticking = true
  try {
    await eachBatch(() => new (useParse()).Query('Project').equalTo('changelog.notify', true), async (projects) => {
      for (const project of projects) {
        try { requireChangelogNotify(project) } catch { continue }
        // A suspended workspace's subscribers hear nothing until it is back.
        if (!(await workspaceIsActive(pointerId(project.get('workspace'))))) continue
        await runChangelogInstantSweep(project, now).catch(error => console.error('[changelog] instant sweep failed:', (error as Error).message))
        await runChangelogWeeklyDigest(project, now).catch(error => console.error('[changelog] weekly digest failed:', (error as Error).message))
      }
    })
  } catch (error) {
    console.error('[changelog] tick failed:', (error as Error).message)
  } finally {
    ticking = false
  }
}
