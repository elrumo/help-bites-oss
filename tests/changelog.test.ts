import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CHANGELOG_CONFIG,
  buildPublicChangelog,
  changelogPrefill,
  changelogReservedSlugs,
  DEFAULT_CHANGELOG_COPY,
  changelogCopy,
  fillChangelogText,
  fillChangelogTokenUrl,
  fillChangelogUrl,
  readChangelogCommentImportItem,
  readChangelogCommentInput,
  changelogTimeline,
  isEntryPublic,
  normalizeChangelogConfig,
  readChangelogEntryInput,
  readChangelogImportItem,
  readChangelogMergeInput,
  readChangelogReleaseInput,
  readChangelogNotifyRunInput,
  readChangelogReviewInput,
  readChangelogRunImportItem,
  readChangelogSubscribeInput,
  readChangelogSubscriptionImportItem,
  readChangelogTokenInput,
  sortEntriesNewestFirst,
  toPublicEntry,
  validateChangelogConfig,
  type ChangelogEntry,
  type ChangelogRelease
} from '../shared/changelog'

const entry = (fields: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id: 'e1',
  projectId: 'p1',
  number: 3,
  slug: 'csv-export',
  title: 'CSV export',
  summary: 'Your library, as CSV.',
  body: 'Export your library as CSV.',
  bodyFormat: 'markdown',
  bodyHtml: '<p>Export your library as CSV.</p>',
  excerpt: 'Export your library as CSV.',
  tag: 'new',
  area: 'editor',
  releaseId: '',
  version: '',
  status: 'published',
  publishedAt: '2026-10-01T00:00:00.000Z',
  pinned: false,
  iconGlyph: '',
  accentColor: '',
  imageUrl: '',
  links: [],
  feedbackPostIds: ['post-secret'],
  boardItemIds: ['item-secret'],
  conversationIds: ['conv-secret'],
  commitShas: ['a'.repeat(40)],
  externalId: 'parse:secret-id',
  reviewStatus: 'approved',
  reviewedBy: 'Reviewer Secret',
  reviewedAt: '2026-10-01T00:00:00.000Z',
  reviewNotes: 'internal notes',
  aiGenerated: false,
  authorName: 'Elías',
  source: 'internal',
  commentCount: 2,
  sources: [{ kind: 'conversation', id: 'conv-secret', number: null, label: 'Ada cannot log in', status: 'done', done: true }],
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...fields
})

const release = (fields: Partial<ChangelogRelease> = {}): ChangelogRelease => ({
  id: 'r1',
  projectId: 'p1',
  version: '2.4',
  title: 'Autumn release',
  summary: 'Faster and tidier.',
  status: 'published',
  publishedAt: '2026-10-02T00:00:00.000Z',
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...fields
})

describe('changelog config', () => {
  test('everything is off by default and a partial update changes only what is sent', () => {
    expect(normalizeChangelogConfig(undefined)).toEqual(DEFAULT_CHANGELOG_CONFIG)
    expect(DEFAULT_CHANGELOG_CONFIG).toMatchObject({ autoDraft: false, enabled: false, comments: false, notify: false, entryUrl: '{siteUrl}/changelog/{slug}' })
    expect(validateChangelogConfig({ autoDraft: true }).config.autoDraft).toBe(true)
    const base = { ...DEFAULT_CHANGELOG_CONFIG, autoDraft: true, enabled: true, areas: ['site'], reservedSlugs: ['rss'], comments: true, commentNotify: ['a@b.co'], entryUrl: 'https://x.test/{slug}' }
    expect(validateChangelogConfig({}, base).config).toEqual(base)
    expect(validateChangelogConfig('nope').errors).toEqual(['changelog must be an object'])
  })

  test('areas and reserved slugs are lowercase keys, deduped; anything else is reported', () => {
    expect(validateChangelogConfig({ areas: ['Site', ' editor ', 'site'] }).config.areas).toEqual(['site', 'editor'])
    expect(validateChangelogConfig({ areas: ['not ok'] }).errors[0]).toContain('areas')
    expect(validateChangelogConfig({ areas: 'site' }).errors).toEqual(['areas must be an array'])
    expect(validateChangelogConfig({ reservedSlugs: Array.from({ length: 51 }, (_, i) => `s${i}`) }).errors[0]).toContain('at most 50')
  })

  test('a project reserves its own slugs on top of the ones the API owns', () => {
    const reserved = changelogReservedSlugs({ ...normalizeChangelogConfig(undefined), reservedSlugs: ['confirm'] })
    for (const slug of ['subscribe', 'import', 'merge', 'confirm']) expect(reserved.has(slug)).toBe(true)
    expect(reserved.has('csv-export')).toBe(false)
  })
})

describe('comments config', () => {
  test('comments and who hears about them are opt-in; the address list is checked', () => {
    expect(validateChangelogConfig({ comments: true, commentNotify: [' Elias@Example.test ', 'elias@example.test'] }).config).toMatchObject({ comments: true, commentNotify: ['elias@example.test'] })
    expect(validateChangelogConfig({ commentNotify: ['not an email'] }).errors[0]).toContain('commentNotify')
    expect(validateChangelogConfig({ commentNotify: Array.from({ length: 6 }, (_, i) => `a${i}@b.co`) }).errors[0]).toContain('commentNotify')
  })

  test('the entry address template must hold {slug} and be http(s) or {siteUrl}-relative', () => {
    expect(validateChangelogConfig({ entryUrl: 'https://example.com/changelog/{slug}' }).errors).toEqual([])
    expect(validateChangelogConfig({ entryUrl: '/changelog/{slug}' }).errors[0]).toContain('entryUrl')
    expect(validateChangelogConfig({ entryUrl: '{siteUrl}/changelog' }).errors[0]).toContain('entryUrl')
    expect(fillChangelogUrl('{siteUrl}/changelog/{slug}', 'https://example.com/', 'csv export')).toBe('https://example.com/changelog/csv%20export')
  })
})

describe('notification config', () => {
  test('notifications are opt-in, with a zone, an hour and a debounce to tune', () => {
    const { config, errors } = validateChangelogConfig({ notify: true, siteName: ' Acme ', digest: { timezone: 'Europe/Madrid', weeklyHour: 9, quietMinutes: 20, maxWaitMinutes: 90 } })
    expect(errors).toEqual([])
    expect(config).toMatchObject({ notify: true, siteName: 'Acme', digest: { timezone: 'Europe/Madrid', weeklyHour: 9, quietMinutes: 20, maxWaitMinutes: 90 } })
    expect(validateChangelogConfig({ digest: { weeklyHour: 9 } }, config).config.digest).toEqual(config.digest)
  })

  test('a bad zone, hour or debounce is reported, and nothing is half-applied', () => {
    expect(validateChangelogConfig({ digest: { timezone: 'Mars/Base' } }).errors[0]).toContain('IANA')
    expect(validateChangelogConfig({ digest: { weeklyHour: 24 } }).errors[0]).toContain('weeklyHour')
    expect(validateChangelogConfig({ digest: { quietMinutes: 0 } }).errors[0]).toContain('quietMinutes')
    const tooShort = validateChangelogConfig({ digest: { quietMinutes: 60, maxWaitMinutes: 30 } })
    expect(tooShort.errors[0]).toContain('maxWaitMinutes')
    expect(tooShort.config.digest).toEqual(DEFAULT_CHANGELOG_CONFIG.digest)
  })

  test('the page links hold what they need', () => {
    expect(validateChangelogConfig({ confirmUrl: 'https://x.test/confirm?token={token}', unsubscribeUrl: '{siteUrl}/u?token={token}', pageUrl: 'https://x.test/changelog' }).errors).toEqual([])
    expect(validateChangelogConfig({ confirmUrl: 'https://x.test/confirm' }).errors[0]).toContain('{token}')
    expect(validateChangelogConfig({ pageUrl: 'ftp://x.test' }).errors[0]).toContain('pageUrl')
    expect(fillChangelogTokenUrl('{siteUrl}/changelog/confirm?token={token}', 'https://x.test/', 'a.b c')).toBe('https://x.test/changelog/confirm?token=a.b%20c')
  })

  test('the email words are overridable by key, the rest stay default', () => {
    const { config, errors } = validateChangelogConfig({ copy: { weeklyIntroOne: 'Here is what I shipped:' } })
    expect(errors).toEqual([])
    const copy = changelogCopy(config)
    expect(copy.weeklyIntroOne).toBe('Here is what I shipped:')
    expect(copy.footerWeekly).toBe(DEFAULT_CHANGELOG_COPY.footerWeekly)
    expect(validateChangelogConfig({ copy: { nope: 'x' } }).errors[0]).toContain('copy.nope')
    expect(validateChangelogConfig({ copy: { footerWeekly: '' } }).errors[0]).toContain('copy.footerWeekly')
    expect(fillChangelogText('{count} changes to {site}, {missing}', { count: 2, site: 'X' })).toBe('2 changes to X, {missing}')
  })
})

describe('subscription input', () => {
  test('a subscribe names how often, or off, and an address when nobody is signed in', () => {
    expect(readChangelogSubscribeInput({ email: ' Ada@Example.test ', frequency: 'weekly' })).toEqual({ frequency: 'weekly', email: 'ada@example.test', errors: [] })
    expect(readChangelogSubscribeInput({ frequency: 'off' }).frequency).toBe('off')
    expect(readChangelogSubscribeInput({ frequency: 'daily' }).errors[0]).toContain('frequency')
    expect(readChangelogSubscribeInput({ frequency: 'instant', email: 'nope' }).errors).toEqual(['email is not a valid address'])
  })

  test('a token comes from the body or, for a one-click unsubscribe, the query', () => {
    expect(readChangelogTokenInput({ token: ' abc ' })).toBe('abc')
    expect(readChangelogTokenInput('List-Unsubscribe=One-Click', 'from-query')).toBe('from-query')
    expect(readChangelogTokenInput({}, undefined)).toBe('')
  })

  test('a notify run names its job', () => {
    expect(readChangelogNotifyRunInput({ job: 'weekly', dryRun: true })).toEqual({ job: 'weekly', dryRun: true, now: null, errors: [] })
    expect(readChangelogNotifyRunInput({ job: 'daily' }).job).toBeNull()
    expect(readChangelogNotifyRunInput({ job: 'instant', now: '2026-09-07T08:00:00Z' }).now?.toISOString()).toBe('2026-09-07T08:00:00.000Z')
    expect(readChangelogNotifyRunInput({ job: 'instant', now: 'soon' }).errors).toEqual(['now is not a valid date'])
  })

  test('an imported subscription keeps its status, cadence and dates; an unsubscribed one stays unsubscribed', () => {
    const { values, errors } = readChangelogSubscriptionImportItem({ externalId: 'parse:s1', email: 'Ada@Example.test', userId: 'u1', displayName: 'Ada', frequency: 'weekly', status: 'unsubscribed', source: 'user', confirmedAt: '2026-08-01T00:00:00.000Z', unsubscribedAt: '2026-09-01T00:00:00.000Z' })
    expect(errors).toEqual([])
    expect(values).toMatchObject({ externalId: 'parse:s1', email: 'ada@example.test', userId: 'u1', frequency: 'weekly', status: 'unsubscribed', source: 'user' })
    expect(values.unsubscribedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(readChangelogSubscriptionImportItem({ email: 'x' }).errors).toHaveLength(2)
    expect(readChangelogSubscriptionImportItem({ externalId: 'a', email: 'a@b.co', frequency: 'hourly', status: 'gone', pendingFrequency: 'x' }).errors).toHaveLength(3)
  })

  test('a past send is a kind and a window', () => {
    const { values, errors } = readChangelogRunImportItem({ kind: 'weekly', windowEnd: '2026-10-05T22:00:00.000Z', windowStart: '2026-09-28T22:00:00.000Z' })
    expect(errors).toEqual([])
    expect(values.windowEnd?.toISOString()).toBe('2026-10-05T22:00:00.000Z')
    expect(readChangelogRunImportItem({ kind: 'monthly' }).errors).toEqual(['kind must be instant or weekly'])
  })
})

describe('comment input', () => {
  test('a comment body and a moderation status are read separately; anything else is reported', () => {
    expect(readChangelogCommentInput({ body: 'Nice' })).toEqual({ body: 'Nice', errors: [] })
    expect(readChangelogCommentInput({ status: 'hidden' })).toEqual({ status: 'hidden', errors: [] })
    expect(readChangelogCommentInput({ body: 4 }).errors).toEqual(['body must be a string'])
    expect(readChangelogCommentInput({ status: 'gone' }).errors[0]).toContain('status must be one of')
    expect(readChangelogCommentInput({})).toEqual({ errors: [] })
  })

  test('an imported comment names its entry and keeps its author, date and status', () => {
    const { values, errors } = readChangelogCommentImportItem({ externalId: 'parse:c1', entry: 'dark-mode', body: 'Hi', status: 'hidden', authorId: 'u1', authorName: 'Ada', authorAvatar: 'https://x.test/a.png', authorIsStaff: true, postedAt: '2026-09-01T10:00:00.000Z', editedAt: '2026-09-02T10:00:00.000Z' })
    expect(errors).toEqual([])
    expect(values).toMatchObject({ externalId: 'parse:c1', entry: 'dark-mode', status: 'hidden', authorId: 'u1', authorName: 'Ada', authorIsStaff: true })
    expect(values.postedAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z')
    expect(readChangelogCommentImportItem({ body: 'x' }).errors).toEqual(['externalId is required', 'entry is required'])
    expect(readChangelogCommentImportItem({ externalId: 'a', entry: 'b', status: 'weird', postedAt: 'never' }).errors).toHaveLength(2)
    expect(readChangelogCommentImportItem({ externalId: 'a', entry: 'b', authorAvatar: 'javascript:alert(1)' }).values.authorAvatar).toBe('')
  })
})

describe('entry input', () => {
  test('create needs a title and defaults to an improved draft', () => {
    expect(readChangelogEntryInput({}, { create: true }).errors).toEqual(['A title is required'])
    const { values, errors } = readChangelogEntryInput({ title: '  CSV export ' }, { create: true })
    expect(errors).toEqual([])
    expect(values).toEqual({ title: 'CSV export', tag: 'improved', status: 'draft' })
  })

  test('the look of an entry: summary, area, format, pinning, glyph, colour, image and links', () => {
    const { values, errors } = readChangelogEntryInput({
      slug: ' CSV Export ', summary: ' Your library, as CSV. ', area: 'Editor', bodyFormat: 'html', pinned: true, iconGlyph: '✨',
      accentColor: '#3366ff', imageUrl: 'https://example.com/a.png', links: [{ label: 'Docs', url: 'https://example.com/docs' }], releaseVersion: ' 2026.10 '
    }, { create: false })
    expect(errors).toEqual([])
    expect(values).toEqual({
      slug: 'CSV Export', summary: 'Your library, as CSV.', area: 'editor', bodyFormat: 'html', pinned: true, iconGlyph: '✨',
      accentColor: '#3366ff', imageUrl: 'https://example.com/a.png', links: [{ label: 'Docs', url: 'https://example.com/docs' }], releaseVersion: '2026.10'
    })
  })

  test('null clears the look; anything malformed is reported', () => {
    expect(readChangelogEntryInput({ iconGlyph: null, accentColor: null, imageUrl: null, links: null, area: null }, { create: false }).values)
      .toEqual({ iconGlyph: '', accentColor: '', imageUrl: '', links: [], area: '' })
    const bad = readChangelogEntryInput({
      summary: 'x'.repeat(301), area: 'Not OK', bodyFormat: 'rtf', pinned: 'yes', accentColor: 'red', imageUrl: 'javascript:alert(1)',
      links: [{ label: 'x', url: 'ftp://nope' }], releaseVersion: 'v'.repeat(61), status: 'live'
    }, { create: false })
    expect(bad.errors).toHaveLength(9)
    expect(readChangelogEntryInput({ links: Array.from({ length: 7 }, () => ({ label: 'x', url: 'https://x.test' })) }, { create: false }).errors[0]).toContain('at most 6')
  })

  test('an entry can be archived', () => {
    expect(readChangelogEntryInput({ status: 'archived' }, { create: false }).values).toEqual({ status: 'archived' })
    expect(readChangelogReleaseInput({ version: '1', status: 'archived' }, { create: true }).errors[0]).toContain('status must be')
  })

  test('an update reads only what is present and reports what is malformed', () => {
    expect(readChangelogEntryInput({ status: 'published' }, { create: false }).values).toEqual({ status: 'published' })
    const bad = readChangelogEntryInput({ tag: 'huge', status: 'live', body: 4, publishedAt: 'never' }, { create: false })
    expect(bad.errors).toHaveLength(4)
    expect(readChangelogEntryInput({ title: 'x'.repeat(201) }, { create: false }).errors[0]).toContain('longer than')
  })

  test('null clears the body and takes the entry out of its release', () => {
    const { values } = readChangelogEntryInput({ body: null, releaseId: null, publishedAt: null }, { create: false })
    expect(values).toEqual({ body: '', releaseId: null, publishedAt: null })
    expect(readChangelogEntryInput({ releaseId: ' r1 ' }, { create: false }).values.releaseId).toBe('r1')
  })

  test('commitShas are full SHAs, lowercased and deduped; anything else is reported', () => {
    const sha = 'ab12'.repeat(10)
    const read = (commitShas: unknown) => readChangelogEntryInput({ commitShas }, { create: false })
    expect(read([sha.toUpperCase(), ` ${sha} `]).values.commitShas).toEqual([sha])
    expect(read([]).values.commitShas).toEqual([])
    expect(readChangelogEntryInput({}, { create: false }).values.commitShas).toBeUndefined()
    for (const bad of [sha, null, ['abc1234'], [sha, 'z'.repeat(40)], Array.from({ length: 51 }, (_, i) => String(i).padStart(40, '0'))]) {
      expect(read(bad).errors[0]).toContain('commitShas must be an array')
    }
  })
})

describe('release input', () => {
  test('a release needs a version', () => {
    expect(readChangelogReleaseInput({ title: 'Autumn' }, { create: true }).errors).toEqual(['A version is required'])
    expect(readChangelogReleaseInput({ version: '2.4' }, { create: true }).values).toEqual({ version: '2.4', status: 'draft' })
    expect(readChangelogReleaseInput({ version: 'v'.repeat(61) }, { create: false }).errors[0]).toContain('longer than')
  })
})

describe('what goes public', () => {
  test('a published entry is public unless its release is still a draft', () => {
    expect(isEntryPublic({ status: 'published' }, null)).toBe(true)
    expect(isEntryPublic({ status: 'published' }, { status: 'published' })).toBe(true)
    expect(isEntryPublic({ status: 'published' }, { status: 'draft' })).toBe(false)
    expect(isEntryPublic({ status: 'draft' }, { status: 'published' })).toBe(false)
    expect(isEntryPublic({ status: 'draft' }, null)).toBe(false)
  })

  test('a public entry carries only its allow-listed fields', () => {
    const out = toPublicEntry(entry(), '2.4')
    expect(Object.keys(out).sort()).toEqual([
      'accentColor', 'area', 'authorName', 'body', 'bodyFormat', 'bodyHtml', 'commentCount', 'excerpt', 'iconGlyph', 'id', 'imageUrl', 'links',
      'number', 'pinned', 'publishedAt', 'slug', 'summary', 'tag', 'title', 'updatedAt', 'version'
    ])
    expect(out.version).toBe('2.4')
    const json = JSON.stringify(out)
    for (const leak of ['secret', 'Ada', 'Reviewer', 'internal notes', 'feedbackPostIds', 'boardItemIds', 'conversationIds', 'sources', 'projectId', 'releaseId', 'status', 'commitShas', 'externalId', 'reviewStatus', 'source']) expect(json).not.toContain(leak)
  })

  test('the public changelog groups entries under published releases, newest first', () => {
    const out = buildPublicChangelog(
      [release(), release({ id: 'r0', version: '2.3', publishedAt: '2026-09-01T00:00:00.000Z' })],
      [
        entry({ id: 'a', number: 1, releaseId: 'r0', publishedAt: '2026-09-01T00:00:00.000Z' }),
        entry({ id: 'b', number: 2, releaseId: 'r1', publishedAt: '2026-10-02T00:00:00.000Z' }),
        entry({ id: 'c', number: 3, releaseId: 'r1', publishedAt: '2026-10-02T00:00:00.000Z' }),
        entry({ id: 'd', number: 4, releaseId: '', publishedAt: '2026-10-05T00:00:00.000Z' })
      ]
    )
    expect(out.releases.map(r => r.version)).toEqual(['2.4', '2.3'])
    expect(out.releases[0]!.entries.map(e => e.id)).toEqual(['c', 'b'])
    expect(out.entries.map(e => e.id)).toEqual(['d'])
  })

  test('drafts, draft releases and releases with nothing published stay out', () => {
    const out = buildPublicChangelog(
      [release(), release({ id: 'r2', version: '2.5', status: 'draft' }), release({ id: 'r3', version: '2.6' })],
      [
        entry({ id: 'a', releaseId: 'r1' }),
        entry({ id: 'b', releaseId: 'r1', status: 'draft' }),
        entry({ id: 'c', releaseId: 'r2' }),
        entry({ id: 'd', releaseId: 'r3', status: 'draft' }),
        entry({ id: 'e', releaseId: 'gone' }),
        entry({ id: 'f', releaseId: '', status: 'draft' })
      ]
    )
    expect(out.releases.map(r => r.version)).toEqual(['2.4'])
    expect(out.releases[0]!.entries.map(e => e.id)).toEqual(['a'])
    expect(out.entries).toEqual([])
    expect(JSON.stringify(out)).not.toContain('secret')
  })
})

describe('archived and reviewed entries', () => {
  test('an archived entry is never public, in a release or not', () => {
    expect(isEntryPublic({ status: 'archived' }, null)).toBe(false)
    expect(isEntryPublic({ status: 'archived' }, { status: 'published' })).toBe(false)
    const out = buildPublicChangelog([release()], [entry({ id: 'a', status: 'archived' }), entry({ id: 'b', releaseId: 'r1', status: 'archived' })])
    expect(out).toEqual({ releases: [], entries: [] })
  })

  test('a public entry in a release carries that release’s version', () => {
    const out = buildPublicChangelog([release()], [entry({ id: 'a', releaseId: 'r1' }), entry({ id: 'b' })])
    expect(out.releases[0]!.entries[0]!.version).toBe('2.4')
    expect(out.entries[0]!.version).toBe('')
  })

  test('entries sort newest first, the higher number first among equals', () => {
    const sorted = sortEntriesNewestFirst([
      { id: 'a', number: 1, publishedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'b', number: 2, publishedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'c', number: 3, publishedAt: '2026-10-05T00:00:00.000Z' },
      { id: 'd', number: 4, publishedAt: null }
    ])
    expect(sorted.map(e => e.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  test('a review is an approve or a reject, with optional notes', () => {
    expect(readChangelogReviewInput({ action: 'approve' })).toEqual({ action: 'approve', notes: '', errors: [] })
    expect(readChangelogReviewInput({ action: 'reject', notes: ' too vague ' })).toEqual({ action: 'reject', notes: 'too vague', errors: [] })
    expect(readChangelogReviewInput({ action: 'maybe' }).errors).toEqual(['action must be approve or reject'])
    expect(readChangelogReviewInput({ action: 'reject', notes: 'x'.repeat(2001) }).errors[0]).toContain('longer than')
  })
})

describe('import and merge input', () => {
  test('an import item needs an externalId and reads only what is sent', () => {
    expect(readChangelogImportItem({ title: 'CSV' }).errors).toEqual(['externalId is required, up to 200 characters'])
    const out = readChangelogImportItem({
      externalId: ' parse:abc ', title: 'CSV export', status: 'published', publishedAt: '2026-09-01T00:00:00.000Z', slug: 'csv-export',
      reviewStatus: 'approved', reviewedBy: 'Elías', reviewedAt: '2026-09-02T00:00:00.000Z', reviewNotes: null, authorName: 'Elías', source: 'internal'
    })
    expect(out.errors).toEqual([])
    expect(out.externalId).toBe('parse:abc')
    expect(out.values.title).toBe('CSV export')
    expect(out.values.tag).toBeUndefined()
    expect(out.values.status).toBe('published')
    expect(out.values.reviewStatus).toBe('approved')
    expect(out.values.reviewNotes).toBeNull()
    expect(out.values.source).toBe('internal')
    expect(readChangelogImportItem({ externalId: 'x', reviewStatus: 'weird', source: 'robot' }).errors).toHaveLength(2)
  })

  test('a merge names 2 to 10 entries and the merged entry', () => {
    expect(readChangelogMergeInput({ refs: ['a', '#3', 'a'], entry: { title: 'Merged' } })).toEqual({ refs: ['a', '3'], entry: { title: 'Merged' }, errors: [] })
    expect(readChangelogMergeInput({ refs: ['a'], entry: { title: 'x' } }).errors[0]).toContain('2 to 10')
    expect(readChangelogMergeInput({ refs: Array.from({ length: 11 }, (_, i) => String(i)), entry: {} }).errors[0]).toContain('2 to 10')
    expect(readChangelogMergeInput({ refs: ['a', 'b'] }).errors).toEqual(['entry (the merged entry) is required'])
  })
})

describe('timeline', () => {
  test('releases and release-less entries interleave by date, newest first', () => {
    const out = buildPublicChangelog(
      [release(), release({ id: 'r0', version: '2.3', publishedAt: '2026-09-01T00:00:00.000Z' })],
      [
        entry({ id: 'a', releaseId: 'r0', publishedAt: '2026-09-01T00:00:00.000Z' }),
        entry({ id: 'b', releaseId: 'r1', publishedAt: '2026-10-02T00:00:00.000Z' }),
        entry({ id: 'c', releaseId: '', publishedAt: '2026-09-15T00:00:00.000Z' }),
        entry({ id: 'd', releaseId: '', publishedAt: '2026-10-02T00:00:00.000Z' })
      ]
    )
    const keys = changelogTimeline(out).map(item => (item.kind === 'release' ? `release ${item.release.version}` : `entry ${item.entry.id}`))
    expect(keys).toEqual(['release 2.4', 'entry d', 'entry c', 'release 2.3'])
    expect(changelogTimeline({ releases: [], entries: [] })).toEqual([])
  })
})

describe('creating an entry from a source', () => {
  test('a post brings its own changelog text, or its text, and a tag from its type', () => {
    expect(changelogPrefill('feedback', { title: 'CSV please', body: 'I need CSV', changelogTitle: 'CSV export', changelogBody: 'Export as CSV', type: 'feature' }))
      .toEqual({ title: 'CSV export', body: 'Export as CSV', tag: 'new' })
    expect(changelogPrefill('feedback', { title: 'Crash on save', body: 'It crashes', type: 'bug' })).toEqual({ title: 'Crash on save', body: 'It crashes', tag: 'fix' })
    expect(changelogPrefill('feedback', { title: 'Faster', type: 'improvement' }).tag).toBe('improved')
  })

  test('a board item brings its public description, never the internal one', () => {
    const out = changelogPrefill('board', { title: 'CSV export', description: 'Internal: the importer needs a rewrite', publicDescription: '' })
    expect(out).toEqual({ title: 'CSV export', body: '', tag: 'improved' })
    expect(JSON.stringify(changelogPrefill('board', { title: 'CSV', description: 'Internal secret', publicDescription: 'Public' }))).not.toContain('secret')
  })

  test('a ticket or error issue brings nothing but a tag', () => {
    const source = { subject: 'Ada cannot log in', body: 'Stack trace at /srv/app', subjectRef: { label: 'TypeError' }, type: 'error' }
    const out = changelogPrefill('conversation', source)
    expect(out).toEqual({ title: '', body: '', tag: 'fix' })
    expect(JSON.stringify(out)).not.toContain('Ada')
    expect(changelogPrefill('conversation', { type: 'support' }).tag).toBe('improved')
  })
})
