import { describe, expect, test } from 'bun:test'
import { FOLLOWER_MAIL_CUTOFF_MS, entryPostIds, followerVerdict, selectFollowerRecipients, shippedMailCopy } from '../shared/changelogFollowers'
import { claimFollowerNotification, type ClaimableEntry } from '../server/utils/changelogFollowers'

const now = new Date('2026-10-21T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('followerVerdict', () => {
  const entry = { status: 'published', releaseStatus: null, publishedAt: ago(60_000), followersNotifiedAt: null } as const

  test('a fresh public entry is mailed', () => {
    expect(followerVerdict(entry, now)).toBe('send')
    expect(followerVerdict({ ...entry, releaseStatus: 'published' }, now)).toBe('send')
  })

  test('drafts, archived entries and entries in a draft release are not public yet', () => {
    expect(followerVerdict({ ...entry, status: 'draft' }, now)).toBe('not-public')
    expect(followerVerdict({ ...entry, status: 'archived' }, now)).toBe('not-public')
    expect(followerVerdict({ ...entry, releaseStatus: 'draft' }, now)).toBe('not-public')
  })

  test('a backdated entry is history, not news', () => {
    expect(followerVerdict({ ...entry, publishedAt: ago(FOLLOWER_MAIL_CUTOFF_MS - 1000) }, now)).toBe('send')
    expect(followerVerdict({ ...entry, publishedAt: ago(FOLLOWER_MAIL_CUTOFF_MS + 1000) }, now)).toBe('stale')
  })

  test('an entry already claimed is never mailed again, whatever else is true', () => {
    expect(followerVerdict({ ...entry, followersNotifiedAt: ago(1000) }, now)).toBe('already-sent')
    expect(followerVerdict({ ...entry, status: 'draft', followersNotifiedAt: ago(1000) }, now)).toBe('already-sent')
  })
})

describe('selectFollowerRecipients', () => {
  const people = [
    { externalId: 'ada', email: 'Ada@Example.com', name: 'Ada' },
    { externalId: 'bob', email: 'bob@example.com', name: 'Bob' },
    { externalId: 'cy', email: 'cy@example.com', name: 'Cy', feedbackEmails: false },
    { externalId: 'dee', email: '', name: 'Dee' },
    { externalId: 'eve', email: 'not-an-address', name: 'Eve' }
  ]

  test('muted follows, opt-outs and people without a usable address are skipped', () => {
    const follows = [
      { postId: 'p1', subscriberId: 'ada', muted: false },
      { postId: 'p1', subscriberId: 'bob', muted: true },
      { postId: 'p1', subscriberId: 'cy', muted: false },
      { postId: 'p1', subscriberId: 'dee', muted: false },
      { postId: 'p1', subscriberId: 'eve', muted: false },
      { postId: 'p1', subscriberId: 'nobody-we-know', muted: false }
    ]
    expect(selectFollowerRecipients(follows, people, ['p1'])).toEqual([{ externalId: 'ada', email: 'ada@example.com', name: 'Ada', postIds: ['p1'] }])
  })

  test('one mail per person, listing every linked post they follow in the entry order', () => {
    const follows = [
      { postId: 'p3', subscriberId: 'ada', muted: false },
      { postId: 'p1', subscriberId: 'ada', muted: false },
      { postId: 'p3', subscriberId: 'ada', muted: false },
      { postId: 'p2', subscriberId: 'ada', muted: true },
      { postId: 'p2', subscriberId: 'bob', muted: false }
    ]
    expect(selectFollowerRecipients(follows, people, ['p1', 'p2', 'p3'])).toEqual([
      { externalId: 'ada', email: 'ada@example.com', name: 'Ada', postIds: ['p1', 'p3'] },
      { externalId: 'bob', email: 'bob@example.com', name: 'Bob', postIds: ['p2'] }
    ])
  })

  test('two contact rows with one address are one person', () => {
    const twins = [{ externalId: 'a1', email: 'x@example.com', name: 'X' }, { externalId: 'a2', email: 'X@example.com', name: 'X' }]
    const follows = [{ postId: 'p1', subscriberId: 'a1', muted: false }, { postId: 'p2', subscriberId: 'a2', muted: false }]
    const out = selectFollowerRecipients(follows, twins, ['p1', 'p2'])
    expect(out).toHaveLength(1)
    expect(out[0]!.postIds).toEqual(['p1', 'p2'])
  })

  test('nobody follows, nobody is mailed', () => {
    expect(selectFollowerRecipients([], people, [])).toEqual([])
  })
})

describe('entryPostIds', () => {
  test('the entry\'s posts, then the posts of its board items, once each', () => {
    expect(entryPostIds(['p1', 'p2'], [{ feedbackPostIds: ['p2', 'p3'] }, { feedbackPostIds: ['p4', 'p1'] }])).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(entryPostIds([], [])).toEqual([])
  })
})

describe('shippedMailCopy', () => {
  test('names the entry, its summary and the posts the person follows', () => {
    const mail = shippedMailCopy({ appName: 'Acme', entryTitle: 'Dark mode', summary: 'It follows your system.', posts: [{ id: 'p1', number: 12, title: 'Add dark mode' }, { id: 'p2', number: null, title: 'Night theme' }] })
    expect(mail.subject).toBe('Shipped: Dark mode')
    expect(mail.body).toContain('“Dark mode” just shipped in Acme.')
    expect(mail.body).toContain('It follows your system.')
    expect(mail.body).toContain('• #12 Add dark mode')
    expect(mail.body).toContain('• Night theme')
    expect(mail.body).toContain('these requests')
  })

  test('a long list is cut and counted', () => {
    const posts = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, number: i + 1, title: `Post ${i + 1}` }))
    const body = shippedMailCopy({ appName: '', entryTitle: 'Big one', posts }).body
    expect(body).toContain('• #10 Post 10')
    expect(body).not.toContain('Post 11')
    expect(body).toContain('• and 3 more')
  })
})

// An in-memory stand-in for the Redis lock (SET NX): refuses while held.
function memoryLock() {
  const held = new Set<string>()
  return async function exclusive<R>(key: string, _ttl: number, fn: () => Promise<R>) {
    if (held.has(key)) return { ran: false as const }
    held.add(key)
    try { return { ran: true as const, value: await fn() } } finally { held.delete(key) }
  }
}

function fakeEntry(fields: Record<string, unknown>): ClaimableEntry & { fields: Record<string, unknown> } {
  return { fields, get: key => fields[key], set: (key, value) => { fields[key] = value } }
}

describe('claimFollowerNotification', () => {
  const published = () => fakeEntry({ status: 'published', publishedAt: ago(60_000), feedbackPostIds: ['p1'] })

  test('the first claim wins and stamps the entry; the second finds it taken', async () => {
    const entry = published()
    let saves = 0
    const deps = { exclusive: memoryLock(), load: async () => ({ entry, releaseStatus: null }), save: async () => { saves++ }, now }
    expect(await claimFollowerNotification('e1', deps)).toBe(entry)
    expect(entry.fields.followersNotifiedAt).toEqual(now)
    expect(await claimFollowerNotification('e1', deps)).toBeNull()
    expect(saves).toBe(1)
  })

  test('two claims at once: only one gets through, the other backs off', async () => {
    const entry = published()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const deps = { exclusive: memoryLock(), load: async () => { await gate; return { entry, releaseStatus: null } }, save: async () => {}, now }
    const first = claimFollowerNotification('e1', deps)
    const second = claimFollowerNotification('e1', deps)
    release()
    const results = await Promise.all([first, second])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  test('an entry that links nothing yet stays unclaimed, so links added later still count', async () => {
    const entry = fakeEntry({ status: 'published', publishedAt: ago(60_000) })
    let saves = 0
    expect(await claimFollowerNotification('e1', { exclusive: memoryLock(), load: async () => ({ entry, releaseStatus: null }), save: async () => { saves++ }, now })).toBeNull()
    expect(saves).toBe(0)
    expect(entry.fields.followersNotifiedAt).toBeUndefined()
  })

  test('an entry that waited in a draft release is as old as the release, not the entry', () => {
    const written = ago(10 * 24 * 60 * 60 * 1000)
    expect(followerVerdict({ status: 'published', releaseStatus: 'published', publishedAt: written, releasePublishedAt: ago(60_000), followersNotifiedAt: null }, now)).toBe('send')
    expect(followerVerdict({ status: 'published', releaseStatus: 'published', publishedAt: written, releasePublishedAt: written, followersNotifiedAt: null }, now)).toBe('stale')
  })

  test('an entry held back by a draft release stays unclaimed, for when the release publishes', async () => {
    const entry = published()
    const claimed = await claimFollowerNotification('e1', { exclusive: memoryLock(), load: async () => ({ entry, releaseStatus: 'draft' as const }), save: async () => {}, now })
    expect(claimed).toBeNull()
    expect(entry.fields.followersNotifiedAt).toBeUndefined()
  })

  test('a backdated entry is stamped so it is never reconsidered, but not mailed', async () => {
    const entry = fakeEntry({ status: 'published', publishedAt: ago(FOLLOWER_MAIL_CUTOFF_MS + 60_000) })
    let saves = 0
    const claimed = await claimFollowerNotification('e1', { exclusive: memoryLock(), load: async () => ({ entry, releaseStatus: null }), save: async () => { saves++ }, now })
    expect(claimed).toBeNull()
    expect(entry.fields.followersNotifiedAt).toEqual(now)
    expect(saves).toBe(1)
  })

  test('a missing entry, or no lock to be had, claims nothing', async () => {
    expect(await claimFollowerNotification('e1', { exclusive: memoryLock(), load: async () => null, save: async () => {}, now })).toBeNull()
    const entry = published()
    const busy = async () => ({ ran: false as const })
    expect(await claimFollowerNotification('e1', { exclusive: busy, load: async () => ({ entry, releaseStatus: null }), save: async () => {}, now })).toBeNull()
    expect(entry.fields.followersNotifiedAt).toBeUndefined()
  })
})
