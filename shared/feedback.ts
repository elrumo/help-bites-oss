// Feedback boards: vocabulary, defaults and validation shared by the API, the
// panel and the embed. A board is per project and fully configurable — its
// statuses, post types and platforms are data, not code — so any host app can
// run its own public "feature requests & bug reports" board without HelpBites
// knowing anything about it.

import { DEFAULT_STYLE_CHOICE, validateStyleChoice, type StyleChoice } from './projectStyle'
import { readItemAttachments, type ItemAttachment } from './itemAttachments'

export const FEEDBACK_TITLE_MAX_LENGTH = 200
export const FEEDBACK_BODY_MAX_LENGTH = 20000
export const FEEDBACK_COMMENT_MAX_LENGTH = 8000
export const FEEDBACK_KEY_MAX_LENGTH = 40
export const FEEDBACK_METADATA_MAX_BYTES = 4096
export const FEEDBACK_PAGE_MAX = 500
/** Tags one post may carry; the board defines up to 40. */
export const FEEDBACK_POST_TAGS_MAX = 4
export const FEEDBACK_ADMIN_NOTE_MAX_LENGTH = 4000

/** The fixed reaction set, GitHub's. Keys never contain ':' — storage relies on it. */
export const FEEDBACK_REACTIONS = ['+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'] as const
export type FeedbackReactionKey = typeof FEEDBACK_REACTIONS[number]

/** `internal` is a team-only note; `hidden` is moderated away. Only `public` counts or notifies. */
export const FEEDBACK_COMMENT_VISIBILITIES = ['public', 'internal', 'hidden'] as const
export type FeedbackCommentVisibility = typeof FEEDBACK_COMMENT_VISIBILITIES[number]

/** What a status *means*, independent of what a project calls it. Drives the
 * default filter (open/planned/active), the roadmap (planned/active/done), the
 * changelog (done) and whether votes are still accepted (not done/closed). */
export const FEEDBACK_STATUS_CATEGORIES = ['open', 'planned', 'active', 'done', 'closed'] as const
export type FeedbackStatusCategory = typeof FEEDBACK_STATUS_CATEGORIES[number]

/** Semantic colours; UIs map them to their own palette. */
export const FEEDBACK_COLORS = ['neutral', 'primary', 'info', 'success', 'warning', 'error'] as const
export type FeedbackColor = typeof FEEDBACK_COLORS[number]

export const FEEDBACK_SORTS = ['top', 'new', 'activity', 'completed'] as const
export type FeedbackSort = typeof FEEDBACK_SORTS[number]

export type FeedbackStatusDefinition = {
  key: string
  label: string
  category: FeedbackStatusCategory
  color: FeedbackColor
  isDefault?: boolean
  /** Email the post's author when it moves into this status. */
  notify?: boolean
}

export type FeedbackTypeDefinition = {
  key: string
  label: string
  /** An Iconify name (`lucide:bug`, `octicon:rocket-16`) or a single emoji. */
  icon: string
  description?: string
}

export type FeedbackPlatformDefinition = { key: string, label: string }

/** A label a post can carry several of (areas, components, …); defined by the board's admins. */
export type FeedbackTagDefinition = { key: string, label: string, color: FeedbackColor }

export type FeedbackBoardConfig = {
  enabled: boolean
  title: string
  description: string
  statuses: FeedbackStatusDefinition[]
  types: FeedbackTypeDefinition[]
  /** Empty hides the platform picker. */
  platforms: FeedbackPlatformDefinition[]
  /** Empty hides the tag picker. A post carries up to FEEDBACK_POST_TAGS_MAX of them. */
  tags: FeedbackTagDefinition[]
  /** Show authors' display names to everyone (admins always see them). */
  showAuthorNames: boolean
  allowComments: boolean
  /** Authors may edit their own title, text, type and platform. */
  allowUserEdits: boolean
  /** Email authors on status changes and participants on new comments. */
  emailNotifications: boolean
  /** Where a post lives on the host site — `{id}`, `{number}` and `{slug}` replaced; used by emails and share links. */
  postUrlTemplate: string
  /** Offer the roadmap and changelog views in the embed. */
  roadmap: boolean
  changelog: boolean
  /** How the public board (its list, roadmap and changelog views) takes its style. */
  style: StyleChoice
}

export const DEFAULT_FEEDBACK_STATUSES: FeedbackStatusDefinition[] = [
  { key: 'open', label: 'Under review', category: 'open', color: 'neutral', isDefault: true },
  { key: 'planned', label: 'Planned', category: 'planned', color: 'warning', notify: true },
  { key: 'in-progress', label: 'In progress', category: 'active', color: 'info', notify: true },
  { key: 'done', label: 'Done', category: 'done', color: 'success', notify: true },
  { key: 'closed', label: 'Closed', category: 'closed', color: 'error' }
]

export const DEFAULT_FEEDBACK_TYPES: FeedbackTypeDefinition[] = [
  { key: 'feature', label: 'Feature request', icon: 'lucide:lightbulb' },
  { key: 'bug', label: 'Bug report', icon: 'lucide:bug' },
  { key: 'improvement', label: 'Improvement', icon: 'lucide:sparkles' },
  { key: 'other', label: 'Other', icon: 'lucide:message-circle' }
]

export const DEFAULT_FEEDBACK_CONFIG: FeedbackBoardConfig = {
  enabled: false,
  title: '',
  description: '',
  statuses: DEFAULT_FEEDBACK_STATUSES,
  types: DEFAULT_FEEDBACK_TYPES,
  platforms: [],
  tags: [],
  showAuthorNames: false,
  allowComments: true,
  allowUserEdits: true,
  emailNotifications: true,
  postUrlTemplate: '',
  roadmap: true,
  changelog: true,
  style: DEFAULT_STYLE_CHOICE
}

// ---- wire types -------------------------------------------------------------

export type FeedbackAuthor = {
  /** '' when the board hides names from this viewer. */
  name: string
  /** Written by the project's team (an operator, or a host user with the admin role). */
  isTeam: boolean
  /** The `@handle` mentions use (the token's `username`); '' when unknown or names are hidden. */
  handle: string
  /** From the token's `avatar` claim; '' when unknown or names are hidden. */
  avatarUrl: string
  /** Admins only. */
  externalId?: string
  email?: string
}

/** `reacted` is viewer-relative: absent from live events. */
export type FeedbackReactionSummary = { key: FeedbackReactionKey, count: number, reacted?: boolean }

/** A post as a reference chip: `#12 Dark mode (planned)`. */
export type FeedbackPostRef = { id: string, number: number | null, title: string, status: string, statusCategory: FeedbackStatusCategory }

export type FeedbackPost = {
  id: string
  projectId: string
  /** Per-project sequence: `#12`. Null only on posts made before numbering existed and not yet backfilled. */
  number: number | null
  /** URL decoration derived from the title; the number (or id) is the identity. */
  slug: string
  title: string
  /** Untrusted user text: Markdown or HTML. Sanitize before rendering. */
  body: string
  type: string
  platform: string
  tags: string[]
  status: string
  statusCategory: FeedbackStatusCategory
  voteCount: number
  commentCount: number
  author: FeedbackAuthor | null
  hidden: boolean
  featured: boolean
  /** No new votes, comments or reactions except from admins. */
  locked: boolean
  showOnChangelog: boolean
  changelogTitle: string
  changelogBody: string
  /** Free text: the release (or changelog entry) that shipped it. */
  shippedIn: string
  icon: string
  pinnedCommentId: string | null
  /** Set when an admin merged this post into another. */
  duplicateOf: FeedbackPostRef | null
  /** Images and files the author attached. */
  attachments: ItemAttachment[]
  /** `#N` numbers the body mentions. */
  refs: number[]
  reactions: FeedbackReactionSummary[]
  editedAt: string | null
  completedAt: string | null
  statusChangedAt: string | null
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
  /** Admins only. */
  externalId?: string
  metadata?: Record<string, unknown>
  adminNote?: string
  /** Relative to the viewer; absent from live events (keep your local values). */
  hasVoted?: boolean
  isMine?: boolean
  canEdit?: boolean
  canDelete?: boolean
  canComment?: boolean
  canVote?: boolean
  /** The viewer follows the post (and hears about it unless `muted`). */
  subscribed?: boolean
  muted?: boolean
  /** Followed, with activity since the viewer last read it. */
  unread?: boolean
}

export type FeedbackComment = {
  id: string
  postId: string
  /** One level of threading: replies point at a top-level comment. */
  parentId: string | null
  /** The comment being answered (may itself be a reply). */
  replyToId: string | null
  visibility: FeedbackCommentVisibility
  body: string
  author: FeedbackAuthor | null
  reactions: FeedbackReactionSummary[]
  refs: number[]
  editedAt: string | null
  createdAt: string
  isMine?: boolean
  canEdit?: boolean
  canDelete?: boolean
}

/** Someone `@` can complete in a thread. Never carries an id or an email. */
export type FeedbackParticipant = { handle: string, name: string, avatarUrl: string, isTeam: boolean }

export type FeedbackViewer = {
  signedIn: boolean
  isAdmin: boolean
  name: string
}

export type FeedbackEvent =
  | { type: 'feedback.post.created' | 'feedback.post.updated', projectId: string, postId: string, post: FeedbackPost }
  | { type: 'feedback.post.deleted', projectId: string, postId: string }
  | { type: 'feedback.comment.created' | 'feedback.comment.updated', projectId: string, postId: string, comment: FeedbackComment, commentCount: number, postHidden: boolean }
  | { type: 'feedback.comment.deleted', projectId: string, postId: string, commentId: string, commentCount: number, postHidden: boolean }

// ---- config -----------------------------------------------------------------

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function normalizeFeedbackKey(value: unknown): string {
  return text(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, FEEDBACK_KEY_MAX_LENGTH)
}

function isCategory(value: unknown): value is FeedbackStatusCategory {
  return (FEEDBACK_STATUS_CATEGORIES as readonly string[]).includes(String(value))
}

function isColor(value: unknown): value is FeedbackColor {
  return (FEEDBACK_COLORS as readonly string[]).includes(String(value))
}

const CATEGORY_COLORS: Record<FeedbackStatusCategory, FeedbackColor> = { open: 'neutral', planned: 'warning', active: 'info', done: 'success', closed: 'error' }

function readList<T extends { key: string }>(value: unknown, read: (raw: Record<string, unknown>, errors: string[], label: string) => T | null, errors: string[], label: string): T[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) { errors.push(`${label} must be an array`); return null }
  const out: T[] = []
  const seen = new Set<string>()
  for (const item of value.slice(0, 40)) {
    const parsed = read((item && typeof item === 'object' ? item : {}) as Record<string, unknown>, errors, label)
    if (!parsed) continue
    const key = parsed.key
    if (seen.has(key)) { errors.push(`${label}: duplicate key "${key}"`); continue }
    seen.add(key)
    out.push(parsed)
  }
  return out
}

function readStatus(raw: Record<string, unknown>, errors: string[]): FeedbackStatusDefinition | null {
  const key = normalizeFeedbackKey(raw.key)
  if (!key) { errors.push('Every status needs a key'); return null }
  if (!isCategory(raw.category)) { errors.push(`Status "${key}" needs a category: ${FEEDBACK_STATUS_CATEGORIES.join(', ')}`); return null }
  return {
    key,
    label: text(raw.label, 60) || key,
    category: raw.category,
    color: isColor(raw.color) ? raw.color : CATEGORY_COLORS[raw.category],
    ...(raw.isDefault === true ? { isDefault: true } : {}),
    ...(raw.notify === true ? { notify: true } : {})
  }
}

function readType(raw: Record<string, unknown>, errors: string[]): FeedbackTypeDefinition | null {
  const key = normalizeFeedbackKey(raw.key)
  if (!key) { errors.push('Every type needs a key'); return null }
  const description = text(raw.description, 200)
  return { key, label: text(raw.label, 60) || key, icon: text(raw.icon, 60), ...(description ? { description } : {}) }
}

function readPlatform(raw: Record<string, unknown>, errors: string[]): FeedbackPlatformDefinition | null {
  const key = normalizeFeedbackKey(raw.key)
  if (!key) { errors.push('Every platform needs a key'); return null }
  return { key, label: text(raw.label, 60) || key }
}

function readTag(raw: Record<string, unknown>, errors: string[]): FeedbackTagDefinition | null {
  const key = normalizeFeedbackKey(raw.key)
  if (!key) { errors.push('Every tag needs a key'); return null }
  return { key, label: text(raw.label, 60) || key, color: isColor(raw.color) ? raw.color : 'neutral' }
}

/**
 * Validate a (partial) board config on top of `base`. Unknown keys are
 * ignored; anything present but malformed is reported rather than coerced, so
 * an admin never saves a board that silently lost a status.
 */
export function validateFeedbackConfig(value: unknown, base: FeedbackBoardConfig = DEFAULT_FEEDBACK_CONFIG): { config: FeedbackBoardConfig, errors: string[] } {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const errors: string[] = []
  const config: FeedbackBoardConfig = { ...base }
  if (raw.style !== undefined) {
    const style = validateStyleChoice(raw.style, base.style ?? DEFAULT_STYLE_CHOICE)
    errors.push(...style.errors)
    config.style = style.choice
  }

  for (const flag of ['enabled', 'showAuthorNames', 'allowComments', 'allowUserEdits', 'emailNotifications', 'roadmap', 'changelog'] as const) {
    if (raw[flag] !== undefined) config[flag] = Boolean(raw[flag])
  }
  if (raw.title !== undefined) config.title = text(raw.title, 120)
  if (raw.description !== undefined) config.description = text(raw.description, 500)
  if (raw.postUrlTemplate !== undefined) {
    const template = text(raw.postUrlTemplate, 300)
    if (template && !/^https?:\/\//i.test(template)) errors.push('postUrlTemplate must be an http(s) URL')
    else config.postUrlTemplate = template
  }

  const statuses = readList(raw.statuses, readStatus, errors, 'statuses')
  if (statuses) {
    if (!statuses.length) errors.push('A board needs at least one status')
    else {
      const defaults = statuses.filter(s => s.isDefault)
      if (defaults.length > 1) errors.push('Only one status can be the default')
      config.statuses = statuses.map((s, i) => (defaults.length === 0 && i === 0 ? { ...s, isDefault: true } : s))
    }
  }
  const types = readList(raw.types, readType, errors, 'types')
  if (types) config.types = types
  const platforms = readList(raw.platforms, readPlatform, errors, 'platforms')
  if (platforms) config.platforms = platforms
  const tags = readList(raw.tags, readTag, errors, 'tags')
  if (tags) config.tags = tags

  return { config, errors }
}

/** Read a stored config leniently: whatever is valid wins, the rest falls back to defaults. */
export function normalizeFeedbackConfig(value: unknown): FeedbackBoardConfig {
  const { config } = validateFeedbackConfig(value)
  if (!config.statuses.length) config.statuses = DEFAULT_FEEDBACK_STATUSES
  return config
}

/** Only the statuses are read, so a project board's config works here too. */
export type FeedbackStatusConfig = Pick<FeedbackBoardConfig, 'statuses'>

export function defaultFeedbackStatus(config: FeedbackStatusConfig): FeedbackStatusDefinition {
  return config.statuses.find(s => s.isDefault) || config.statuses[0] || DEFAULT_FEEDBACK_STATUSES[0]!
}

export function feedbackStatusDefinition(config: FeedbackStatusConfig, key: unknown): FeedbackStatusDefinition | undefined {
  return config.statuses.find(s => s.key === key)
}

/** A status the config no longer knows reads as 'open', so the post stays visible. */
export function feedbackStatusCategory(config: FeedbackStatusConfig, key: unknown): FeedbackStatusCategory {
  return feedbackStatusDefinition(config, key)?.category || 'open'
}

export function votingOpen(category: FeedbackStatusCategory): boolean {
  return category !== 'done' && category !== 'closed'
}

/** The board's default filter: everything still being considered or worked on. */
export const ACTIVE_FEEDBACK_CATEGORIES: FeedbackStatusCategory[] = ['open', 'planned', 'active']

export function feedbackPostUrl(config: FeedbackBoardConfig, siteUrl: string, post: string | { id: string, number?: number | null, title?: string }): string {
  const { id, number, title } = typeof post === 'string' ? { id: post, number: null, title: '' } : post
  if (config.postUrlTemplate) {
    return config.postUrlTemplate
      .replaceAll('{id}', encodeURIComponent(id))
      // A post without a number links by id, so the template still resolves.
      .replaceAll('{number}', number ? String(number) : encodeURIComponent(id))
      .replaceAll('{slug}', feedbackSlug(title || ''))
      .replace(/-(?=$|[?#])/, '')
  }
  const base = String(siteUrl || '').replace(/\/+$/, '')
  return base ? `${base}/?feedback=${encodeURIComponent(id)}` : ''
}

// ---- references -------------------------------------------------------------

/** URL decoration from a title: lowercase ASCII words joined by dashes, ≤ 80 chars. */
export function feedbackSlug(title: string): string {
  return String(title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/** `123` or `123-any-slug` → 123; anything else → null. The slug half is advisory. */
export function parsePostRef(value: unknown): number | null {
  const match = /^(\d{1,9})(?:-[\w-]{0,200})?$/.exec(String(value ?? '').trim())
  if (!match) return null
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** `text` without its code spans (a run of backticks to the next run of the same length), each replaced by a space. One pass: each opener looks up its closer, never rescans for it. */
function stripCodeSpans(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map(match => ({ at: match.index ?? 0, length: match[0].length }))
  if (runs.length < 2) return text
  const byLength = new Map<number, number[]>()
  runs.forEach((run, i) => { const list = byLength.get(run.length); if (list) list.push(i); else byLength.set(run.length, [i]) })
  const cursor = new Map<number, number>()
  let out = ''
  let copied = 0
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!
    const list = byLength.get(open.length) ?? []
    let next = cursor.get(open.length) ?? 0
    while (next < list.length && (list[next] ?? 0) <= i) next++
    cursor.set(open.length, next)
    const closing = list[next]
    if (closing === undefined) continue
    const close = runs[closing]!
    out += `${text.slice(copied, open.at)} `
    copied = close.at + close.length
    i = closing
  }
  return out + text.slice(copied)
}

/**
 * Prose only: fenced blocks, code spans, tags, link targets and bare URLs
 * removed, so `#404` in a code sample or `https://x.dev/a#12` never reads as a
 * reference and `mailto:a@b.c` never reads as a mention.
 */
export function stripNonProse(body: string): string {
  // A fence opens with a whole run of its marker (no giving characters back to retry shorter), and a code span is found by
  // its run's length: a text of nothing but backticks must not cost the square of its length.
  return stripCodeSpans(String(body || '')
    .replace(/^[ \t]*(`{3,}(?!`)|~{3,}(?!~))[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm, ' '))
    .replace(/<[^<>]*>/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\bmailto:\S+/gi, ' ')
}

/**
 * `#123` in prose, deduplicated in order, at most 50. A leading word character
 * (`x#5`) or an entity (`&#123;`) is not a reference, and six digits or more
 * read as a hex colour.
 */
export function parseFeedbackRefs(body: string): number[] {
  const out: number[] = []
  for (const match of stripNonProse(body).matchAll(/(?:^|[\s([{,;:*_-])#(\d{1,5})(?![\d\w])/g)) {
    const number = Number(match[1])
    if (number >= 1 && !out.includes(number)) out.push(number)
    if (out.length >= 50) break
  }
  return out
}

/**
 * `@handle` candidates in prose, lowercased and deduplicated. Whitespace (or an
 * opening bracket) before the `@` keeps `ada@example.com` from mentioning
 * `example.com`; trailing punctuation is trimmed.
 */
export function parseFeedbackMentions(body: string): string[] {
  const out: string[] = []
  for (const match of stripNonProse(body).matchAll(/(?:^|[\s([{,;:])@([A-Za-z0-9][\w.-]{0,38})/g)) {
    const handle = String(match[1]).replace(/[._-]+$/, '').toLowerCase()
    if (handle.length >= 2 && !out.includes(handle)) out.push(handle)
    if (out.length >= 20) break
  }
  return out
}

// ---- reactions --------------------------------------------------------------

/** Rows store reactions as `"<key>:<actorId>"`; actor ids may contain ':' themselves. */
export function feedbackReactionEntry(key: string, actorId: string): string {
  return `${key}:${actorId}`
}

export function isFeedbackReaction(value: unknown): value is FeedbackReactionKey {
  return (FEEDBACK_REACTIONS as readonly string[]).includes(String(value))
}

/** Counts per key in the fixed order, zeros skipped; `actorId` adds `reacted`. */
export function summarizeFeedbackReactions(entries: unknown, actorId?: string): FeedbackReactionSummary[] {
  const counts = new Map<string, { count: number, reacted: boolean }>()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = String(entry)
    const split = value.indexOf(':')
    if (split < 1) continue
    const key = value.slice(0, split)
    if (!isFeedbackReaction(key)) continue
    const slot = counts.get(key) || { count: 0, reacted: false }
    slot.count++
    if (actorId && value.slice(split + 1) === actorId) slot.reacted = true
    counts.set(key, slot)
  }
  return FEEDBACK_REACTIONS.filter(key => counts.has(key)).map((key) => {
    const { count, reacted } = counts.get(key)!
    return actorId === undefined ? { key, count } : { key, count, reacted }
  })
}

// ---- post input -------------------------------------------------------------

export const FEEDBACK_USER_FIELDS = ['title', 'body', 'type', 'platform', 'tags'] as const
export const FEEDBACK_ADMIN_FIELDS = ['status', 'hidden', 'featured', 'locked', 'showOnChangelog', 'changelogTitle', 'changelogBody', 'shippedIn', 'icon', 'pinnedCommentId', 'adminNote', 'completedAt', 'metadata', 'externalId'] as const
/** Only `POST /v1/feedback/import` may set these: history keeps its numbers and edit marks. */
export const FEEDBACK_IMPORT_FIELDS = ['number', 'editedAt'] as const

export type FeedbackPostValues = Partial<{
  title: string
  body: string
  type: string
  platform: string
  tags: string[]
  status: string
  hidden: boolean
  featured: boolean
  locked: boolean
  showOnChangelog: boolean
  changelogTitle: string
  changelogBody: string
  shippedIn: string
  icon: string
  pinnedCommentId: string | null
  adminNote: string
  attachments: ItemAttachment[]
  completedAt: Date | null
  metadata: Record<string, unknown>
  externalId: string
  number: number
  editedAt: Date | null
}>

export function readDate(raw: unknown, label: string, errors: string[]): Date | null | undefined {
  if (raw === null || raw === '') return null
  const date = new Date(typeof raw === 'object' && raw && 'iso' in raw ? String((raw as { iso: unknown }).iso) : String(raw))
  if (Number.isNaN(date.getTime())) { errors.push(`${label} is not a valid date`); return undefined }
  return date
}

/**
 * Read a create/update body. Admin-only keys from a non-admin are dropped, not
 * rejected: older clients send them unconditionally and the safe reading is
 * "you asked for something you may not have". Everything else is validated.
 */
export function readFeedbackPostInput(payload: unknown, config: FeedbackBoardConfig, options: { admin: boolean, create: boolean, import?: boolean }): { values: FeedbackPostValues, errors: string[] } {
  const raw = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>
  const values: FeedbackPostValues = {}
  const errors: string[] = []
  const has = (key: string) => raw[key] !== undefined

  if (has('title') || options.create) {
    const title = text(raw.title, FEEDBACK_TITLE_MAX_LENGTH + 1)
    if (!title) errors.push('A title is required')
    else if (title.length > FEEDBACK_TITLE_MAX_LENGTH) errors.push(`The title is longer than ${FEEDBACK_TITLE_MAX_LENGTH} characters`)
    else values.title = title
  }
  if (has('body')) {
    if (typeof raw.body !== 'string') errors.push('body must be a string')
    else if (raw.body.length > FEEDBACK_BODY_MAX_LENGTH) errors.push(`The text is longer than ${FEEDBACK_BODY_MAX_LENGTH} characters`)
    else values.body = raw.body.trim()
  }
  if (has('type')) {
    const type = normalizeFeedbackKey(raw.type)
    if (type && !config.types.some(t => t.key === type)) errors.push(`Unknown type: ${type}`)
    else values.type = type
  }
  if (has('platform')) {
    const platform = normalizeFeedbackKey(raw.platform)
    if (platform && !config.platforms.some(p => p.key === platform)) errors.push(`Unknown platform: ${platform}`)
    else values.platform = platform
  }
  if (has('tags')) {
    if (raw.tags !== null && !Array.isArray(raw.tags)) errors.push('tags must be an array')
    else {
      const tags = [...new Set((raw.tags as unknown[] | null || []).map(normalizeFeedbackKey).filter(Boolean))]
      const unknown = tags.filter(tag => !config.tags.some(t => t.key === tag))
      if (unknown.length) errors.push(`Unknown tag: ${unknown.join(', ')}`)
      else if (tags.length > FEEDBACK_POST_TAGS_MAX) errors.push(`A post can have at most ${FEEDBACK_POST_TAGS_MAX} tags`)
      else values.tags = tags
    }
  }

  if (has('attachments')) {
    const attachments = readItemAttachments(raw.attachments, errors)
    if (attachments) values.attachments = attachments
  }

  if (!options.admin) return { values, errors }

  if (has('status')) {
    const status = normalizeFeedbackKey(raw.status)
    if (!feedbackStatusDefinition(config, status)) errors.push(`Unknown status: ${status}`)
    else values.status = status
  }
  for (const flag of ['hidden', 'featured', 'locked', 'showOnChangelog'] as const) {
    if (has(flag)) values[flag] = Boolean(raw[flag])
  }
  if (has('changelogTitle')) values.changelogTitle = raw.changelogTitle === null ? '' : text(raw.changelogTitle, FEEDBACK_TITLE_MAX_LENGTH)
  if (has('changelogBody')) values.changelogBody = raw.changelogBody === null ? '' : String(raw.changelogBody).slice(0, FEEDBACK_BODY_MAX_LENGTH).trim()
  if (has('shippedIn')) values.shippedIn = raw.shippedIn === null ? '' : text(raw.shippedIn, 200)
  if (has('adminNote')) values.adminNote = raw.adminNote === null ? '' : String(raw.adminNote).slice(0, FEEDBACK_ADMIN_NOTE_MAX_LENGTH).trim()
  // Checked against the post's comments by the server; here only its shape.
  if (has('pinnedCommentId')) values.pinnedCommentId = raw.pinnedCommentId ? text(raw.pinnedCommentId, 40) : null
  if (has('icon')) values.icon = raw.icon === null ? '' : text(raw.icon, 60)
  if (has('externalId')) values.externalId = raw.externalId === null ? '' : text(raw.externalId, 200)
  if (has('completedAt')) {
    const date = readDate(raw.completedAt, 'completedAt', errors)
    if (date !== undefined) values.completedAt = date
  }
  if (has('metadata')) {
    const metadata = raw.metadata
    if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) errors.push('metadata must be an object')
    else if (JSON.stringify(metadata || {}).length > FEEDBACK_METADATA_MAX_BYTES) errors.push(`metadata is larger than ${FEEDBACK_METADATA_MAX_BYTES} bytes`)
    else values.metadata = (metadata || {}) as Record<string, unknown>
  }

  if (!options.import) return { values, errors }

  if (has('number') && raw.number !== null) {
    const number = Number(raw.number)
    if (!Number.isSafeInteger(number) || number < 1) errors.push('number must be a positive integer')
    else values.number = number
  }
  if (has('editedAt')) {
    const date = readDate(raw.editedAt, 'editedAt', errors)
    if (date !== undefined) values.editedAt = date
  }
  return { values, errors }
}

// ---- display helpers ----------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'' }

/** Plain text from a Markdown-or-HTML body, for previews, emails and search. */
export function feedbackPlainText(body: unknown, maxLength = 0): string {
  const flat = String(body ?? '')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/blockquote|\/pre)\s*\/?>/gi, '\n')
    .replace(/<[^<>]*>/g, '')
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name] || '')
    // The Markdown that would read as noise in a one-line preview.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/^ {0,3}(#{1,6}|>)\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!maxLength || flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength - 1).trimEnd()}…`
}

/** An icon string is either an Iconify name (`set:name`, `i-set-name`) or literal text such as an emoji. */
export function isIconifyName(icon: string): boolean {
  return /^i-[a-z0-9]+-[a-z0-9-]+$/i.test(icon) || /^[a-z0-9-]+:[a-z0-9-]+$/i.test(icon)
}
