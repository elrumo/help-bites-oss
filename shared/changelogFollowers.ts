import { normalizeEmail } from './contacts'

// "Shipped" mail for the people who follow what a changelog entry answers.
// When an entry goes public, everyone following one of its linked feedback
// posts (or a post reached through a linked board item) hears about it once.
// Pure rules live here so the server and the tests share them; the sending is
// server/utils/changelogFollowers.ts.

/** Entries published longer ago than this are old news, not mail (the same cutoff the subscribers' sweep uses). */
export const FOLLOWER_MAIL_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000

/** A post list in a mail stops here; the rest are counted. */
export const FOLLOWER_MAIL_POSTS_MAX = 10

export type FollowerEntryState = {
  status: string
  /** The entry's release; null when it has none. */
  releaseStatus: 'draft' | 'published' | null
  publishedAt: Date | null
  followersNotifiedAt: Date | null
}

export type FollowerVerdict = 'send' | 'already-sent' | 'not-public' | 'stale'

/**
 * Whether an entry's followers should be mailed now. Public means published,
 * in a release that is published too (or none). A backdated entry is history:
 * `stale` tells the caller to mark it done without mailing.
 */
export function followerVerdict(entry: FollowerEntryState, now: Date): FollowerVerdict {
  if (entry.followersNotifiedAt) return 'already-sent'
  if (entry.status !== 'published' || entry.releaseStatus === 'draft') return 'not-public'
  if (entry.publishedAt && now.getTime() - entry.publishedAt.getTime() > FOLLOWER_MAIL_CUTOFF_MS) return 'stale'
  return 'send'
}

export type FollowerSubscription = { postId: string, subscriberId: string, muted: boolean }
export type FollowerPerson = { externalId: string, email: string, name: string, feedbackEmails?: boolean }
export type FollowerPost = { id: string, number: number | null, title: string }
export type FollowerRecipient = { externalId: string, email: string, name: string, postIds: string[] }

/**
 * Who gets the mail, and which of the posts they follow it names. Muted
 * follows do not count; people who switched feedback mail off or have no usable
 * address are skipped. One mail per person: someone following several linked
 * posts (or two contact rows sharing an address) gets one, listing them all, in
 * the order of `postOrder`.
 */
export function selectFollowerRecipients(follows: FollowerSubscription[], people: FollowerPerson[], postOrder: string[]): FollowerRecipient[] {
  const followed = new Map<string, Set<string>>()
  for (const follow of follows) {
    if (follow.muted || !follow.subscriberId || !follow.postId) continue
    const posts = followed.get(follow.subscriberId) || new Set<string>()
    posts.add(follow.postId)
    followed.set(follow.subscriberId, posts)
  }

  const byEmail = new Map<string, { person: FollowerPerson, email: string, posts: Set<string> }>()
  for (const person of people) {
    const posts = followed.get(person.externalId)
    if (!posts || person.feedbackEmails === false) continue
    const email = normalizeEmail(person.email)
    if (!email) continue
    const seen = byEmail.get(email)
    if (seen) for (const id of posts) seen.posts.add(id)
    else byEmail.set(email, { person, email, posts: new Set(posts) })
  }

  const rank = new Map(postOrder.map((id, i) => [id, i]))
  const order = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER
  return [...byEmail.values()].map(({ person, email, posts }) => ({
    externalId: person.externalId,
    email,
    name: person.name,
    postIds: [...posts].sort((a, b) => order(a) - order(b))
  }))
}

/** The post ids an entry reaches: its own links, then those of its linked board items, deduplicated in order. */
export function entryPostIds(feedbackPostIds: string[], boardItems: { feedbackPostIds: string[] }[]): string[] {
  return [...new Set([...feedbackPostIds, ...boardItems.flatMap(item => item.feedbackPostIds)].filter(Boolean))]
}

const quoted = (value: string) => `“${value}”`

/** The subject and plain-text body of the mail one follower gets. `posts` are the ones they follow, already in order. */
export function shippedMailCopy(input: { appName: string, entryTitle: string, summary?: string, posts: FollowerPost[] }): { subject: string, body: string } {
  const title = input.entryTitle.trim() || 'An update'
  const named = input.posts.slice(0, FOLLOWER_MAIL_POSTS_MAX)
  const more = input.posts.length - named.length
  const lines = named.map(post => `• ${post.number ? `#${post.number} ` : ''}${post.title}`)
  if (more > 0) lines.push(`• and ${more} more`)
  const parts = [`${quoted(title)} just shipped${input.appName ? ` in ${input.appName}` : ''}.`]
  if (input.summary?.trim()) parts.push(input.summary.trim())
  if (lines.length) parts.push(`You're getting this because you follow ${input.posts.length === 1 ? 'this request' : 'these requests'}:\n${lines.join('\n')}`)
  return { subject: `Shipped: ${title}`.slice(0, 200), body: parts.join('\n\n') }
}
