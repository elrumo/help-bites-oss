import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_FEEDBACK_CONFIG,
  feedbackPlainText,
  feedbackPostUrl,
  feedbackStatusCategory,
  isIconifyName,
  normalizeFeedbackConfig,
  feedbackSlug,
  parseFeedbackMentions,
  parseFeedbackRefs,
  parsePostRef,
  summarizeFeedbackReactions,
  readFeedbackPostInput,
  validateFeedbackConfig,
  votingOpen,
  type FeedbackBoardConfig,
  type FeedbackComment,
  type FeedbackEvent,
  type FeedbackPost
} from '../shared/feedback'
import {
  feedbackEdited,
  feedbackEventForViewer,
  feedbackParticipation,
  feedbackPermissions,
  feedbackRecipients,
  feedbackUnread,
  importReactions,
  readFeedbackListQuery,
  serializeFeedbackAuthor,
  serializeFeedbackComment,
  serializeFeedbackPost,
  statusTransition,
  threadParentId,
  type FeedbackActor,
  type FeedbackContext
} from '../server/utils/feedback'
import { iso, pointerId } from '../server/utils/parse'

const config: FeedbackBoardConfig = { ...DEFAULT_FEEDBACK_CONFIG, enabled: true, platforms: [{ key: 'web', label: 'Web' }], tags: [{ key: 'editor', label: 'Editor', color: 'info' }, { key: 'api', label: 'API', color: 'neutral' }] }
// The serializers lean on two of nitro's auto-imports.
Object.assign(globalThis, { pointerId, iso })

// Just enough of a Parse row for the serializers.
const fakeRow = (fields: Record<string, unknown>, id = 'row1') => ({ id, get: (key: string) => fields[key], createdAt: undefined, updatedAt: undefined }) as never

const user = (externalId: string, isAdmin = false): FeedbackActor => ({ kind: 'user', externalId, name: externalId, isAdmin, claims: { iss: 'pk', sub: externalId, iat: 0, exp: 0 } })

describe('board config', () => {
  test('a stored config is read leniently on top of the defaults', () => {
    const read = normalizeFeedbackConfig({ enabled: true, title: '  Ideas  ', statuses: 'nonsense' })
    expect(read.enabled).toBe(true)
    expect(read.title).toBe('Ideas')
    expect(read.statuses).toEqual(DEFAULT_FEEDBACK_CONFIG.statuses)
  })

  test('validation reports malformed statuses instead of dropping them', () => {
    const { errors } = validateFeedbackConfig({ statuses: [{ key: 'a', category: 'open' }, { key: 'b', category: 'later' }, { key: 'a', category: 'done' }] })
    expect(errors.some(e => e.includes('category'))).toBe(true)
    expect(errors.some(e => e.includes('duplicate'))).toBe(true)
  })

  test('the first status becomes the default when none is marked; two defaults are an error', () => {
    const { config: one } = validateFeedbackConfig({ statuses: [{ key: 'New', category: 'open' }, { key: 'done', category: 'done' }] })
    expect(one.statuses[0]).toMatchObject({ key: 'new', isDefault: true, color: 'neutral' })
    expect(validateFeedbackConfig({ statuses: [{ key: 'a', category: 'open', isDefault: true }, { key: 'b', category: 'open', isDefault: true }] }).errors).toContain('Only one status can be the default')
    expect(validateFeedbackConfig({ statuses: [] }).errors).toContain('A board needs at least one status')
  })

  test('partial updates keep the rest of the base config', () => {
    const base = { ...config, title: 'Board' }
    const { config: next, errors } = validateFeedbackConfig({ showAuthorNames: true }, base)
    expect(errors).toEqual([])
    expect(next.title).toBe('Board')
    expect(next.platforms).toEqual(base.platforms)
    expect(next.showAuthorNames).toBe(true)
  })

  test('post URLs come from the template, else the site URL', () => {
    expect(feedbackPostUrl({ ...config, postUrlTemplate: 'https://a.test/f?id={id}' }, '', 'p 1')).toBe('https://a.test/f?id=p%201')
    expect(feedbackPostUrl(config, 'https://a.test/', 'p1')).toBe('https://a.test/?feedback=p1')
    expect(feedbackPostUrl(config, '', 'p1')).toBe('')
    expect(validateFeedbackConfig({ postUrlTemplate: 'javascript:alert(1)' }).errors).toContain('postUrlTemplate must be an http(s) URL')
  })
})

describe('post input', () => {
  test('a title is required on create and keys are checked against the board', () => {
    expect(readFeedbackPostInput({}, config, { admin: false, create: true }).errors).toContain('A title is required')
    expect(readFeedbackPostInput({ title: 'x', type: 'nope' }, config, { admin: false, create: true }).errors).toContain('Unknown type: nope')
    expect(readFeedbackPostInput({ title: 'x', platform: 'web', type: 'Bug' }, config, { admin: false, create: true })).toEqual({ values: { title: 'x', platform: 'web', type: 'bug' }, errors: [] })
  })

  test('admin-only keys from users are dropped, not rejected', () => {
    const { values, errors } = readFeedbackPostInput({ title: 'x', status: 'done', hidden: true, metadata: { a: 1 } }, config, { admin: false, create: true })
    expect(errors).toEqual([])
    expect(values).toEqual({ title: 'x' })
  })

  test('admins can set moderation fields; null clears strings and dates', () => {
    const { values, errors } = readFeedbackPostInput({ status: 'done', hidden: 1, changelogTitle: null, completedAt: null, metadata: { sha: 'abc' } }, config, { admin: true, create: false })
    expect(errors).toEqual([])
    expect(values).toEqual({ status: 'done', hidden: true, changelogTitle: '', completedAt: null, metadata: { sha: 'abc' } })
    expect(readFeedbackPostInput({ status: 'later' }, config, { admin: true, create: false }).errors).toContain('Unknown status: later')
    expect(readFeedbackPostInput({ metadata: { big: 'x'.repeat(5000) } }, config, { admin: true, create: false }).errors[0]).toContain('metadata')
  })
})

describe('statuses', () => {
  test('categories drive voting', () => {
    expect(feedbackStatusCategory(config, 'in-progress')).toBe('active')
    expect(feedbackStatusCategory(config, 'retired-key')).toBe('open')
    expect(votingOpen('planned')).toBe(true)
    expect(votingOpen('done')).toBe(false)
    expect(votingOpen('closed')).toBe(false)
  })

  test('completedAt is stamped the first time a post lands in done, and kept after', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const earlier = new Date('2025-06-01T00:00:00Z')
    expect(statusTransition(config, 'open', 'done', undefined, now)).toEqual({ completedAt: now, changed: true })
    expect(statusTransition(config, 'open', 'done', earlier, now).completedAt).toBe(earlier)
    expect(statusTransition(config, 'done', 'done', undefined, now)).toEqual({ completedAt: undefined, changed: false })
    expect(statusTransition(config, 'done', 'closed', earlier, now)).toEqual({ completedAt: earlier, changed: true })
  })
})

describe('permissions', () => {
  test('authors edit while the board allows it; admins and operators always', () => {
    expect(feedbackPermissions(user('u1'), 'u1', config)).toEqual({ isMine: true, canEdit: true, canDelete: true })
    expect(feedbackPermissions(user('u1'), 'u1', { ...config, allowUserEdits: false })).toEqual({ isMine: true, canEdit: false, canDelete: true })
    expect(feedbackPermissions(user('u2'), 'u1', config)).toEqual({ isMine: false, canEdit: false, canDelete: false })
    expect(feedbackPermissions(user('u2', true), 'u1', config)).toEqual({ isMine: false, canEdit: true, canDelete: true })
    expect(feedbackPermissions({ kind: 'agent', agent: {} as never }, 'u1', config).canDelete).toBe(true)
    expect(feedbackPermissions({ kind: 'anonymous' }, 'u1', config)).toEqual({ isMine: false, canEdit: false, canDelete: false })
  })

  test('an empty author id never matches (team and imported posts)', () => {
    expect(feedbackPermissions(user(''), '', config).isMine).toBe(false)
  })

  test('author names follow the board setting, except for the team and admins', () => {
    const endUser = fakeRow({ username: 'ada', avatarUrl: 'https://x.test/a.png', email: 'ada@x.test' })
    const row = { authorExternalId: 'u1', authorName: 'Ada', authorIsTeam: false, endUser }
    expect(serializeFeedbackAuthor(row, config, false)).toEqual({ name: '', isTeam: false, handle: '', avatarUrl: '' })
    expect(serializeFeedbackAuthor(row, { ...config, showAuthorNames: true }, false)).toEqual({ name: 'Ada', isTeam: false, handle: 'ada', avatarUrl: 'https://x.test/a.png' })
    expect(serializeFeedbackAuthor({ ...row, authorIsTeam: true }, config, false)).toMatchObject({ name: 'Ada', isTeam: true, handle: 'ada' })
    expect(serializeFeedbackAuthor(row, config, true)).toEqual({ name: 'Ada', isTeam: false, handle: 'ada', avatarUrl: 'https://x.test/a.png', externalId: 'u1', email: 'ada@x.test' })
    expect(serializeFeedbackAuthor({ authorExternalId: '', authorName: '', authorIsTeam: false, endUser: null }, config, false)).toBeNull()
  })
})

describe('list query', () => {
  test('defaults per view', () => {
    expect(readFeedbackListQuery({}, config)).toMatchObject({ view: 'board', sort: 'top', limit: 100, offset: 0, featured: null, statuses: [] })
    expect(readFeedbackListQuery({ view: 'changelog' }, config).sort).toBe('completed')
  })

  test('categories expand to the board’s own status keys; an unknown category matches nothing', () => {
    expect(readFeedbackListQuery({ category: 'open,active' }, config).statuses).toEqual(['open', 'in-progress'])
    expect(readFeedbackListQuery({ category: 'someday' }, config).statuses).toEqual(['__none__'])
  })

  test('limits are clamped and flags parsed', () => {
    const q = readFeedbackListQuery({ limit: '9999', offset: '-4', featured: 'true', mine: '1', type: 'bug, feature' }, config)
    expect(q).toMatchObject({ limit: 500, offset: 0, featured: true, mine: true, types: ['bug', 'feature'] })
  })
})

describe('live events', () => {
  const post = { id: 'p1', hidden: true } as FeedbackPost
  test('hidden posts disappear for non-admins', () => {
    const updated: FeedbackEvent = { type: 'feedback.post.updated', projectId: 'pr', postId: 'p1', post }
    expect(feedbackEventForViewer(updated, false)).toEqual({ type: 'feedback.post.deleted', projectId: 'pr', postId: 'p1' })
    expect(feedbackEventForViewer({ ...updated, type: 'feedback.post.created' }, false)).toBeNull()
    expect(feedbackEventForViewer(updated, true)).toBe(updated)
    expect(feedbackEventForViewer({ type: 'feedback.comment.deleted', projectId: 'pr', postId: 'p1', commentId: 'c', commentCount: 0, postHidden: true }, false)).toBeNull()
  })
})

describe('display helpers', () => {
  test('plain text from HTML or Markdown bodies', () => {
    expect(feedbackPlainText('<p>Hello <strong>there</strong></p><p>Two &amp; three</p>')).toBe('Hello there\nTwo & three')
    expect(feedbackPlainText('## Title\n**bold** [link](https://x.test) `code`')).toBe('Title\nbold link code')
    expect(feedbackPlainText('**bold** text', 8)).toBe('bold te…')
  })

  test('icons are Iconify names or literal text', () => {
    expect(isIconifyName('lucide:bug')).toBe(true)
    expect(isIconifyName('octicon:rocket-16')).toBe(true)
    expect(isIconifyName('i-lucide-bug')).toBe(true)
    expect(isIconifyName('🚀')).toBe(false)
  })
})

describe('tags', () => {
  test('board tags validate like platforms, with a colour', () => {
    const { config: board, errors } = validateFeedbackConfig({ tags: [{ key: 'Icon Packs', label: 'Icon packs', color: 'nonsense' }, { key: 'api', color: 'info' }] })
    expect(errors).toEqual([])
    expect(board.tags).toEqual([{ key: 'icon-packs', label: 'Icon packs', color: 'neutral' }, { key: 'api', label: 'api', color: 'info' }])
    expect(validateFeedbackConfig({ tags: [{ key: 'a' }, { key: 'a' }] }).errors.some(e => e.includes('duplicate'))).toBe(true)
    expect(normalizeFeedbackConfig({}).tags).toEqual([])
  })

  test('posts carry known tags, deduplicated, at most four', () => {
    expect(readFeedbackPostInput({ tags: ['Editor', 'editor', 'api'] }, config, { admin: false, create: false }).values.tags).toEqual(['editor', 'api'])
    expect(readFeedbackPostInput({ tags: ['nope'] }, config, { admin: false, create: false }).errors).toEqual(['Unknown tag: nope'])
    const many = { ...config, tags: ['a', 'b', 'c', 'd', 'e'].map(key => ({ key, label: key, color: 'neutral' as const })) }
    expect(readFeedbackPostInput({ tags: ['a', 'b', 'c', 'd', 'e'] }, many, { admin: false, create: false }).errors[0]).toContain('at most 4')
    expect(readFeedbackListQuery({ tag: 'editor,api' }, config).tags).toEqual(['editor', 'api'])
  })
})

describe('admin and import fields', () => {
  test('lock, notes, shippedIn and pins are admin-only; number and editedAt are import-only', () => {
    const raw = { locked: true, adminNote: 'dup of #4', shippedIn: 'v2.1', pinnedCommentId: 'c1', number: 7, editedAt: '2024-01-02T00:00:00Z' }
    expect(readFeedbackPostInput(raw, config, { admin: false, create: false }).values).toEqual({})
    const admin = readFeedbackPostInput(raw, config, { admin: true, create: false }).values
    expect(admin).toEqual({ locked: true, adminNote: 'dup of #4', shippedIn: 'v2.1', pinnedCommentId: 'c1' })
    const imported = readFeedbackPostInput({ ...raw, title: 'x' }, config, { admin: true, create: true, import: true })
    expect(imported.values.number).toBe(7)
    expect(imported.values.editedAt?.toISOString()).toBe('2024-01-02T00:00:00.000Z')
    expect(readFeedbackPostInput({ title: 'x', number: -1 }, config, { admin: true, create: true, import: true }).errors).toEqual(['number must be a positive integer'])
  })

  test('Parse { iso } dates are accepted for completedAt (imports send them)', () => {
    expect(readFeedbackPostInput({ completedAt: { __type: 'Date', iso: '2024-03-04T05:06:07.000Z' } }, config, { admin: true, create: false }).values.completedAt?.toISOString()).toBe('2024-03-04T05:06:07.000Z')
  })

  test('the admin note never reaches non-admins', () => {
    const row = fakeRow({ title: 'Dark mode', adminNote: 'secret', number: 3, project: { id: 'pr' } })
    const ctx = (actor: FeedbackActor): FeedbackContext => ({ project: {} as never, config, actor })
    expect(serializeFeedbackPost(row, ctx({ kind: 'anonymous' })).adminNote).toBeUndefined()
    expect(serializeFeedbackPost(row, ctx(user('u1', true))).adminNote).toBe('secret')
    expect(serializeFeedbackPost(row, ctx({ kind: 'anonymous' }))).toMatchObject({ number: 3, slug: 'dark-mode', tags: [], locked: false, duplicateOf: null })
  })
})

describe('references', () => {
  test('numbers resolve from `12` and `12-slug`, nothing else', () => {
    expect(parsePostRef('12')).toBe(12)
    expect(parsePostRef('12-dark-mode')).toBe(12)
    expect(parsePostRef('aBc123XyZ0')).toBeNull()
    expect(parsePostRef('0')).toBeNull()
    expect(feedbackSlug('Ünïcode & spaces!')).toBe('unicode-spaces')
  })

  test('#N in prose only; code, links, entities and hex colours are not references', () => {
    expect(parseFeedbackRefs('Same as #12 and (#4), again #12')).toEqual([12, 4])
    expect(parseFeedbackRefs('`#5` ```\n#6\n``` https://x.dev/a#7 x#8 &#123; #ffffff #123456')).toEqual([])
  })

  test('@mentions skip emails and trailing punctuation', () => {
    expect(parseFeedbackMentions('thanks @Ada! cc @bob. mail ada@example.com')).toEqual(['ada', 'bob'])
  })

  test('post URLs fill {number} and {slug}, and fall back to the id', () => {
    const board = { ...config, postUrlTemplate: 'https://x.test/feedback/{number}-{slug}' }
    expect(feedbackPostUrl(board, '', { id: 'p1', number: 12, title: 'Dark mode' })).toBe('https://x.test/feedback/12-dark-mode')
    expect(feedbackPostUrl(board, '', { id: 'p1', number: null, title: '' })).toBe('https://x.test/feedback/p1')
    expect(feedbackPostUrl({ ...config, postUrlTemplate: 'https://x.test/?p={id}' }, '', 'p1')).toBe('https://x.test/?p=p1')
  })
})

describe('comments', () => {
  test('replies stay one level deep', () => {
    expect(threadParentId({ id: 'c1', parentId: null })).toBe('c1')
    expect(threadParentId({ id: 'c2', parentId: 'c1' })).toBe('c1')
  })

  test('team notes and moderated comments never reach non-admins live', () => {
    const comment = { id: 'c1', visibility: 'internal' } as FeedbackComment
    const created: FeedbackEvent = { type: 'feedback.comment.created', projectId: 'pr', postId: 'p1', comment, commentCount: 0, postHidden: false }
    expect(feedbackEventForViewer(created, false)).toBeNull()
    expect(feedbackEventForViewer(created, true)).toBe(created)
    const hidden: FeedbackEvent = { ...created, type: 'feedback.comment.updated', comment: { ...comment, visibility: 'hidden' } }
    expect(feedbackEventForViewer(hidden, false)).toEqual({ type: 'feedback.comment.deleted', projectId: 'pr', postId: 'p1', commentId: 'c1', commentCount: 0, postHidden: false })
    const visible = { ...created, comment: { ...comment, visibility: 'public' as const } }
    expect(feedbackEventForViewer(visible, false)).toBe(visible)
  })

  test('comments carry their thread fields and a reaction summary', () => {
    const row = fakeRow({ post: { id: 'p1' }, parentId: 'c0', visibility: 'internal', body: 'x', reactions: ['heart:u1', 'heart:u2'] })
    const ctx: FeedbackContext = { project: {} as never, config, actor: user('u1') }
    expect(serializeFeedbackComment(row, ctx)).toMatchObject({ parentId: 'c0', replyToId: null, visibility: 'internal', reactions: [{ key: 'heart', count: 2, reacted: true }], isMine: false, canEdit: false })
  })
})

describe('reactions', () => {
  test('summaries keep the fixed order, skip junk, and split on the first colon', () => {
    const entries = ['rocket:u1', '+1:u2', '+1:legacy:abc', 'bogus:u1', 'nocolon', 42]
    expect(summarizeFeedbackReactions(entries)).toEqual([{ key: '+1', count: 2 }, { key: 'rocket', count: 1 }])
    expect(summarizeFeedbackReactions(entries, 'legacy:abc')).toEqual([{ key: '+1', count: 2, reacted: true }, { key: 'rocket', count: 1, reacted: false }])
    expect(summarizeFeedbackReactions(undefined)).toEqual([])
  })

  test('imports map keys to user ids and drop unknown keys', () => {
    expect(importReactions({ '+1': ['u1', 'u1', ''], party: ['u2'], heart: ['u3'] })).toEqual(['+1:u1', 'heart:u3'])
    expect(importReactions(null)).toBeNull()
  })
})

describe('following', () => {
  test('recipients: unmuted followers, the author when they never had a row, never the actor', () => {
    const subscribers = [{ id: 'a', muted: false }, { id: 'b', muted: true }, { id: 'c', muted: false }]
    expect(feedbackRecipients({ subscribers, author: 'author', actor: 'c' })).toEqual(['a', 'author'])
    expect(feedbackRecipients({ subscribers, author: 'b', actor: '' })).toEqual(['a', 'c'])
    expect(feedbackRecipients({ subscribers, author: '', actor: '', exclude: ['a'] })).toEqual(['c'])
  })

  test('unread means activity after the last read (or the follow)', () => {
    const t = (s: number) => new Date(s * 1000)
    expect(feedbackUnread(t(10), { lastReadAt: t(5) })).toBe(true)
    expect(feedbackUnread(t(10), { lastReadAt: t(20) })).toBe(false)
    expect(feedbackUnread(t(10), { createdAt: t(20) })).toBe(false)
    expect(feedbackUnread(t(10), undefined)).toBe(false)
  })

  test('locks stop users but not admins; closed statuses stop votes', () => {
    expect(feedbackParticipation(user('u1'), config, { locked: true, statusCategory: 'open' })).toEqual({ canComment: false, canVote: false })
    expect(feedbackParticipation(user('u1', true), config, { locked: true, statusCategory: 'open' })).toEqual({ canComment: true, canVote: true })
    expect(feedbackParticipation(user('u1'), config, { locked: false, statusCategory: 'done' })).toEqual({ canComment: true, canVote: false })
    expect(feedbackParticipation({ kind: 'anonymous' }, config, { locked: false, statusCategory: 'open' })).toEqual({ canComment: false, canVote: false })
  })
})

describe('edited', () => {
  const current = (fields: Record<string, unknown>) => (key: string) => fields[key]
  test('words changed by anyone, or re-filed by the author; triage is not an edit', () => {
    const row = current({ title: 'A', body: 'x', type: 'bug', tags: ['api'] })
    expect(feedbackEdited({ title: 'B' }, row, false)).toBe(true)
    expect(feedbackEdited({ title: 'A', body: 'x' }, row, true)).toBe(false)
    expect(feedbackEdited({ type: 'feature' }, row, true)).toBe(true)
    expect(feedbackEdited({ type: 'feature', tags: ['editor'] }, row, false)).toBe(false)
    expect(feedbackEdited({ tags: ['api'] }, row, true)).toBe(false)
    expect(feedbackEdited({ status: 'done' }, row, true)).toBe(false)
  })
})
