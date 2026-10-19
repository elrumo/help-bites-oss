import { describe, expect, test } from 'bun:test'
import { DEFAULT_CHANGELOG_COPY, changelogCopy } from '../shared/changelog'
import { changelogConfirmVariables, changelogDigestVariables, greetingFirstName, shouldFlushPending, weeklyWindowFor, weeklyWindowLabel } from '../server/utils/changelogDigest'
import { changelogLinkSecret, createChangelogToken, verifyChangelogToken } from '../server/utils/changelogTokens'

const QUIET = 30 * 60 * 1000
const MAX_WAIT = 60 * 60 * 1000
const minutes = (n: number) => n * 60 * 1000

describe('shouldFlushPending', () => {
  const now = new Date('2026-08-24T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  test('nothing pending never flushes', () => {
    expect(shouldFlushPending([], now, QUIET, MAX_WAIT)).toBe(false)
  })

  test('a lone fresh entry waits out the quiet period', () => {
    expect(shouldFlushPending([ago(minutes(10))], now, QUIET, MAX_WAIT)).toBe(false)
    expect(shouldFlushPending([ago(minutes(30))], now, QUIET, MAX_WAIT)).toBe(true)
  })

  test('a burst holds while it is still growing', () => {
    expect(shouldFlushPending([ago(minutes(45)), ago(minutes(5))], now, QUIET, MAX_WAIT)).toBe(false)
  })

  test('a slow drip flushes at the max-wait cap even while noisy', () => {
    expect(shouldFlushPending([ago(minutes(60)), ago(minutes(2))], now, QUIET, MAX_WAIT)).toBe(true)
  })

  test('a settled burst flushes on quiet', () => {
    expect(shouldFlushPending([ago(minutes(40)), ago(minutes(31))], now, QUIET, MAX_WAIT)).toBe(true)
  })
})

describe('weeklyWindowFor', () => {
  test('mid-week: the previous full Monday-to-Monday week, and due', () => {
    const window = weeklyWindowFor(new Date('2026-08-26T10:00:00Z'), 'Europe/Madrid', 8)
    expect(window.windowStart.toISOString()).toBe('2026-08-16T22:00:00.000Z')
    expect(window.windowEnd.toISOString()).toBe('2026-08-23T22:00:00.000Z')
    expect(window.due).toBe(true)
  })

  test('Monday before the send hour is not yet due, after it is', () => {
    expect(weeklyWindowFor(new Date('2026-08-24T05:00:00Z'), 'Europe/Madrid', 8).due).toBe(false)
    expect(weeklyWindowFor(new Date('2026-08-24T07:00:00Z'), 'Europe/Madrid', 8).due).toBe(true)
    expect(weeklyWindowFor(new Date('2026-08-24T07:00:00Z'), 'Europe/Madrid', 10).due).toBe(false)
  })

  test('Sunday still belongs to the running week', () => {
    const window = weeklyWindowFor(new Date('2026-08-23T10:00:00Z'), 'Europe/Madrid', 8)
    expect(window.windowEnd.toISOString()).toBe('2026-08-16T22:00:00.000Z')
    expect(window.due).toBe(true)
  })

  test('spans the October DST transition without gaps', () => {
    const window = weeklyWindowFor(new Date('2026-10-26T09:00:00Z'), 'Europe/Madrid', 8)
    expect(window.windowStart.toISOString()).toBe('2026-10-18T22:00:00.000Z')
    expect(window.windowEnd.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(window.due).toBe(true)
  })

  test('another zone moves the week with it', () => {
    // 07:00Z is exactly Monday midnight in Los Angeles: that week ends right now, and goes out at 08:00 local.
    const midnight = weeklyWindowFor(new Date('2026-08-24T07:00:00Z'), 'America/Los_Angeles', 8)
    expect(midnight.windowEnd.toISOString()).toBe('2026-08-24T07:00:00.000Z')
    expect(midnight.windowStart.toISOString()).toBe('2026-08-17T07:00:00.000Z')
    expect(midnight.due).toBe(false)
    expect(weeklyWindowFor(new Date('2026-08-24T15:30:00Z'), 'America/Los_Angeles', 8).due).toBe(true)
  })

  test('the label names the Monday-to-Sunday span', () => {
    const window = weeklyWindowFor(new Date('2026-08-24T07:00:00Z'), 'Europe/Madrid', 8)
    expect(weeklyWindowLabel(window, 'Europe/Madrid')).toBe('17 Aug – 23 Aug')
  })
})

describe('changelogDigestVariables', () => {
  const copy = changelogCopy({ copy: {} })
  const base = {
    copy,
    siteName: 'Acme',
    entryUrl: (slug: string) => `https://example.com/changelog/${slug}`,
    pageUrl: 'https://example.com/changelog',
    entries: [
      { slug: 'faster-search', title: 'Faster search', summary: 'Search is quicker now', tag: 'improved' },
      { slug: 'dark-mode', title: 'Dark <mode>', excerpt: 'A & B', tag: 'new' }
    ]
  }

  test('a single entry uses its title as the subject, several use a count', () => {
    expect(changelogDigestVariables({ ...base, entries: base.entries.slice(0, 1), kind: 'instant' }).subjectLine).toBe('Faster search')
    expect(changelogDigestVariables({ ...base, kind: 'instant' }).subjectLine).toBe("What's new on Acme — 2 updates")
  })

  test('the weekly subject carries the window, and the footer says weekly', () => {
    const vars = changelogDigestVariables({ ...base, kind: 'weekly', windowLabel: '17 Aug – 23 Aug' })
    expect(vars.subjectLine).toBe('This week on Acme (17 Aug – 23 Aug)')
    expect(vars.footerNote).toContain('weekly')
    expect(changelogDigestVariables({ ...base, kind: 'weekly' }).subjectLine).toBe('This week on Acme')
  })

  test('the intro counts the changes; a project can speak in its own voice', () => {
    expect(changelogDigestVariables({ ...base, kind: 'instant' }).intro).toBe('We just shipped 2 changes to Acme:')
    expect(changelogDigestVariables({ ...base, entries: base.entries.slice(0, 1), kind: 'instant' }).intro).toBe('We just shipped a change to Acme:')
    const mine = changelogCopy({ copy: { instantIntroMany: 'I just shipped {count} changes to {site}:' } })
    expect(changelogDigestVariables({ ...base, copy: mine, kind: 'instant' }).intro).toBe('I just shipped 2 changes to Acme:')
  })

  test('escapes entry content and links every entry', () => {
    const { entriesHtml, preheader, changelogUrl } = changelogDigestVariables({ ...base, kind: 'instant' })
    expect(entriesHtml).toContain('Dark &lt;mode&gt;')
    expect(entriesHtml).toContain('A &amp; B')
    expect(entriesHtml).not.toContain('Dark <mode>')
    expect(entriesHtml).toContain('https://example.com/changelog/faster-search')
    expect(entriesHtml).toContain('https://example.com/changelog/dark-mode')
    expect(entriesHtml).toContain('>Improved<')
    expect(preheader).toBe('Faster search · Dark <mode>')
    expect(changelogUrl).toBe('https://example.com/changelog')
  })

  test('the confirm mail carries the link and describes the cadence', () => {
    expect(changelogConfirmVariables({ confirmUrl: 'https://x.test/confirm?token=t', frequency: 'weekly', copy })).toEqual({ cadence: DEFAULT_CHANGELOG_COPY.confirmWeekly, confirmUrl: 'https://x.test/confirm?token=t' })
    expect(changelogConfirmVariables({ confirmUrl: 'u', frequency: 'instant', copy }).cadence).toBe(DEFAULT_CHANGELOG_COPY.confirmInstant)
  })
})

describe('greetingFirstName', () => {
  test('first word of a name; never an email or a placeholder handle', () => {
    expect(greetingFirstName('Ada Lovelace')).toBe('Ada')
    expect(greetingFirstName('ada@example.test')).toBe('there')
    expect(greetingFirstName('user-abc123XYZ')).toBe('there')
    expect(greetingFirstName('')).toBe('there')
    expect(greetingFirstName(null)).toBe('there')
    expect(greetingFirstName('<b>Ada</b>')).toBe('bAda/b')
  })
})

describe('signed links', () => {
  const secret = 'test-secret'
  const issued = new Date('2026-10-01T10:00:00Z')

  test('a token names the subscription and its purpose, never an email', () => {
    const token = createChangelogToken('unsub', 'sub123', issued, secret)
    expect(verifyChangelogToken(token, issued, secret)).toEqual({ valid: true, purpose: 'unsub', subscriptionId: 'sub123' })
    expect(Buffer.from(token.split('.')[0]!, 'base64url').toString()).toBe(`unsub:sub123:${Math.floor(issued.getTime() / 1000)}`)
  })

  test('a confirm link expires after a week; an unsubscribe link never does', () => {
    const later = new Date(issued.getTime() + 8 * 24 * 60 * 60 * 1000)
    expect(verifyChangelogToken(createChangelogToken('confirm', 's1', issued, secret), later, secret)).toEqual({ valid: false, error: 'Token has expired' })
    expect(verifyChangelogToken(createChangelogToken('confirm', 's1', issued, secret), new Date(issued.getTime() + 6 * 24 * 60 * 60 * 1000), secret).valid).toBe(true)
    expect(verifyChangelogToken(createChangelogToken('unsub', 's1', issued, secret), new Date('2030-01-01'), secret).valid).toBe(true)
  })

  test('a tampered, truncated or foreign token is refused', () => {
    const token = createChangelogToken('unsub', 'sub123', issued, secret)
    const [payload, hmac] = token.split('.') as [string, string]
    const forged = Buffer.from(`unsub:other:${Math.floor(issued.getTime() / 1000)}`).toString('base64url')
    expect(verifyChangelogToken(`${forged}.${hmac}`, issued, secret)).toEqual({ valid: false, error: 'Invalid token signature' })
    expect(verifyChangelogToken(`${payload}.00`, issued, secret).valid).toBe(false)
    expect(verifyChangelogToken(token, issued, 'another-secret').valid).toBe(false)
    expect(verifyChangelogToken('garbage', issued, secret).valid).toBe(false)
    expect(verifyChangelogToken(undefined, issued, secret).valid).toBe(false)
    expect(verifyChangelogToken(`${Buffer.from('other:x:1').toString('base64url')}.aa`, issued, secret)).toEqual({ valid: false, error: 'Invalid token purpose' })
  })

  test('without a secret nothing is signed or accepted', () => {
    expect(() => createChangelogToken('unsub', 's', issued, '')).toThrow('CHANGELOG_LINK_SECRET')
    expect(verifyChangelogToken('a.b', issued, '')).toEqual({ valid: false, error: 'Links are not configured' })
  })

  test('a CHANGELOG_LINK_SECRET under 32 characters counts as unset; unset, a key derived from HELPBITES_SECRET signs', () => {
    const saved = { own: process.env.CHANGELOG_LINK_SECRET, root: process.env.HELPBITES_SECRET }
    const restore = (key: string, value: string | undefined) => (value === undefined ? delete process.env[key] : (process.env[key] = value))
    try {
      process.env.HELPBITES_SECRET = 'root-secret-that-is-at-least-32-characters'
      process.env.CHANGELOG_LINK_SECRET = 'x'.repeat(31)
      expect(changelogLinkSecret()).toBe('')
      expect(() => createChangelogToken('unsub', 's1')).toThrow('32+ characters')
      expect(verifyChangelogToken(createChangelogToken('unsub', 's1', issued, 'x'.repeat(31)))).toEqual({ valid: false, error: 'Links are not configured' })

      process.env.CHANGELOG_LINK_SECRET = 'x'.repeat(32)
      const token = createChangelogToken('unsub', 's1', issued)
      expect(verifyChangelogToken(token, issued, 'x'.repeat(32)).valid).toBe(true)

      delete process.env.CHANGELOG_LINK_SECRET
      expect(changelogLinkSecret()).toMatch(/^[0-9a-f]{64}$/)
      expect(verifyChangelogToken(token).valid).toBe(false)
      expect(verifyChangelogToken(createChangelogToken('unsub', 's1')).valid).toBe(true)

      delete process.env.HELPBITES_SECRET
      expect(changelogLinkSecret()).toBe('')
    } finally {
      restore('CHANGELOG_LINK_SECRET', saved.own)
      restore('HELPBITES_SECRET', saved.root)
    }
  })

  test('links the Acme backend signed verify here, with the same secret', () => {
    // Its format: base64url("unsub:<parseObjectId>:<seconds>") + "." + hex(HMAC-SHA256(payload)).
    const legacy = createChangelogToken('unsub', 'AbC123xyz9', new Date('2026-08-24T08:00:00Z'), 'shared-with-acme')
    expect(verifyChangelogToken(legacy, new Date('2027-01-01'), 'shared-with-acme')).toMatchObject({ valid: true, subscriptionId: 'AbC123xyz9' })
  })
})
