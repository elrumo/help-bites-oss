import { entryPostIds, followerVerdict, selectFollowerRecipients, shippedMailCopy, type FollowerSubscription, type FollowerVerdict } from '#shared/changelogFollowers'
import type { DomainEvent } from '#shared/domainEvents'
import { feedbackPostUrl } from '#shared/feedback'
import { changelogEntryUrl } from './changelog'
import { emailFeedbackFollowers, getFeedbackConfig, type FeedbackContext } from './feedback'
import type { ParseObject } from './parse'

// When a changelog entry goes public, the people following the feedback posts
// it answers hear about it: the posts it links directly, and those reached
// through the board items it links. Wired to the `changelog.entry.published`
// domain event (server/plugins/changelogFollowers.ts).
//
// At-most-once, like the subscribers' sweep: `followersNotifiedAt` is claimed
// under a lock BEFORE anything is sent, so a retry, a second instance or an
// entry published twice never mails anyone twice. A send that fails is logged
// and not retried; the publish that caused it has long since succeeded.

const CLAIM_LOCK_SECONDS = 60
/** Followers are looked up this many posts' worth of subscriptions at a time, and people this many ids at a time. */
const PEOPLE_PAGE = 500

type Exclusive = <R>(key: string, ttlSeconds: number, fn: () => Promise<R>) => Promise<{ ran: true, value: R } | { ran: false }>

export type ClaimableEntry = { get(key: string): unknown, set(key: string, value: unknown): unknown }

export type FollowerClaimDeps<T extends ClaimableEntry> = {
  exclusive: Exclusive
  /** The entry as stored right now (never a copy from before the lock), with its release's status. */
  load: () => Promise<{ entry: T, releaseStatus: 'draft' | 'published' | null } | null>
  save: (entry: T) => Promise<void>
  now?: Date
}

const dateOf = (value: unknown): Date | null => (value instanceof Date ? value : null)

/**
 * Take the right to mail an entry's followers: the entry, if it is public,
 * fresh and not yet claimed (now stamped `followersNotifiedAt`), else null. A
 * backdated entry is stamped too, without mailing, so it is never reconsidered.
 */
export async function claimFollowerNotification<T extends ClaimableEntry>(entryId: string, deps: FollowerClaimDeps<T>): Promise<T | null> {
  const held = await deps.exclusive(`sb:changelog:followers:${entryId}`, CLAIM_LOCK_SECONDS, async () => {
    const found = await deps.load()
    if (!found) return null
    const now = deps.now ?? new Date()
    const verdict: FollowerVerdict = followerVerdict({
      status: String(found.entry.get('status') || ''),
      releaseStatus: found.releaseStatus,
      publishedAt: dateOf(found.entry.get('publishedAt')),
      followersNotifiedAt: dateOf(found.entry.get('followersNotifiedAt'))
    }, now)
    if (verdict === 'send' || verdict === 'stale') {
      found.entry.set('followersNotifiedAt', now)
      await deps.save(found.entry)
    }
    return verdict === 'send' ? found.entry : null
  })
  return held.ran ? held.value : null
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter(Boolean) : [])

async function loadClaimable(project: ParseObject, entryId: string): Promise<{ entry: ParseObject, releaseStatus: 'draft' | 'published' | null } | null> {
  const Parse = useParse()
  const entry = await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('objectId', entryId).first(MASTER)
  if (!entry) return null
  const releaseId = pointerId(entry.get('release'))
  if (!releaseId) return { entry, releaseStatus: null }
  const release = await new Parse.Query('ChangelogRelease').equalTo('project', project).equalTo('objectId', releaseId).first(MASTER)
  // A release that is gone no longer holds the entry back.
  return { entry, releaseStatus: release ? (release.get('status') === 'published' ? 'published' : 'draft') : null }
}

/** The `changelog.entry.published` handler: claim the entry, then mail its followers. Never throws. */
export async function notifyChangelogFollowers(event: DomainEvent, project: ParseObject): Promise<void> {
  const entryId = String(event.data.entryId || '')
  if (!entryId) return
  try {
    // A suspended workspace's followers hear nothing, and the entry stays unclaimed.
    if (!(await workspaceIsActive(pointerId(project.get('workspace'))))) return
    const claimed = await claimFollowerNotification(entryId, {
      exclusive: (key, ttl, fn) => runExclusive(key, ttl, fn, { failOpen: true }),
      load: () => loadClaimable(project, entryId),
      save: async (entry) => { await entry.save(null, MASTER) }
    })
    if (claimed) await mailFollowers(project, claimed)
  } catch (error) {
    console.error('[changelog] could not mail the followers of entry', entryId, (error as Error).message)
  }
}

/** Everyone following any of these posts, a page of subscriptions at a time. */
async function loadFollows(project: ParseObject, postIds: string[]): Promise<FollowerSubscription[]> {
  const Parse = useParse()
  const pointers = postIds.map(id => Parse.Object.extend('FeedbackPost').createWithoutData(id))
  const follows: FollowerSubscription[] = []
  await eachBatch(() => new Parse.Query('FeedbackSubscription').equalTo('project', project).containedIn('post', pointers), (rows) => {
    for (const row of rows) follows.push({ postId: pointerId(row.get('post')), subscriberId: String(row.get('subscriberId') || ''), muted: row.get('muted') === true })
  }, { keys: ['post', 'subscriberId', 'muted'] })
  return follows
}

/** The contact rows for these host user ids (project-scoped), minus those that switched feedback mail off. */
async function loadPeople(project: ParseObject, externalIds: string[]) {
  const people: { externalId: string, email: string, name: string, feedbackEmails?: boolean }[] = []
  for (let start = 0; start < externalIds.length; start += PEOPLE_PAGE) {
    const ids = externalIds.slice(start, start + PEOPLE_PAGE)
    await eachBatch(() => new (useParse()).Query('EndUser').equalTo('project', project).containedIn('externalId', ids).notEqualTo('feedbackEmails', false), (rows) => {
      for (const row of rows) people.push({ externalId: String(row.get('externalId') || ''), email: String(row.get('email') || ''), name: String(row.get('name') || ''), feedbackEmails: row.get('feedbackEmails') === false ? false : undefined })
    }, { keys: ['externalId', 'email', 'name', 'feedbackEmails'] })
  }
  return people
}

/** Mail each follower once. Returns how many mails went out. */
async function mailFollowers(project: ParseObject, entry: ParseObject): Promise<number> {
  const Parse = useParse()
  const config = getFeedbackConfig(project)
  if (!config.emailNotifications) return 0

  const boardIds = stringList(entry.get('boardItemIds'))
  const items = boardIds.length
    ? await collectAll(() => new Parse.Query('BoardItem').equalTo('project', project).containedIn('objectId', boardIds), { max: boardIds.length, keys: ['feedbackPostIds'] })
    : []
  const postIds = entryPostIds(stringList(entry.get('feedbackPostIds')), items.map(item => ({ feedbackPostIds: stringList(item.get('feedbackPostIds')) })))
  if (!postIds.length) return 0

  // Hidden posts are not named in a mail, and nobody is mailed only about one.
  const postRows = await collectAll(() => new Parse.Query('FeedbackPost').equalTo('project', project).containedIn('objectId', postIds), { max: postIds.length, keys: ['title', 'number', 'hidden'] })
  const posts = new Map(postRows.filter(row => row.get('hidden') !== true).map(row => [row.id || '', { id: row.id || '', number: typeof row.get('number') === 'number' ? row.get('number') as number : null, title: String(row.get('title') || '') }]))
  if (!posts.size) return 0

  const follows = await loadFollows(project, [...posts.keys()])
  if (!follows.length) return 0
  const people = await loadPeople(project, [...new Set(follows.filter(follow => !follow.muted).map(follow => follow.subscriberId))])
  const recipients = selectFollowerRecipients(follows, people, postIds)
  if (!recipients.length) return 0

  const appName = String(project.get('name') || '')
  const siteUrl = String(project.get('siteUrl') || '')
  // Without a site URL the template yields a relative path, which is no link in a mail.
  const publicUrl = changelogEntryUrl(project, entry)
  const entryUrl = /^https?:\/\//.test(publicUrl) ? publicUrl : ''
  const ctx: FeedbackContext = { project, config, actor: { kind: 'anonymous' } }
  const title = String(entry.get('title') || '')
  const summary = String(entry.get('summary') || entry.get('excerpt') || '')
  return await emailFeedbackFollowers(ctx, 'shipped', String(project.get('fromName') || appName || 'The team'), recipients.map((recipient) => {
    const followed = recipient.postIds.map(id => posts.get(id)).filter((post): post is NonNullable<typeof post> => Boolean(post))
    const { subject, body } = shippedMailCopy({ appName, entryTitle: title, summary, posts: followed })
    // The public entry when the project has one; else the (first) post they follow.
    const ctaUrl = entryUrl || (followed[0] ? feedbackPostUrl(config, siteUrl, followed[0]) : '')
    return { email: recipient.email, name: recipient.name, subject, body, ctaUrl, ctaLabel: entryUrl ? 'See what shipped' : 'View the post' }
  }))
}
