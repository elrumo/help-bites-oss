// The changelog: what shipped, written for the public. Shared by the API, the
// panel and the embed. An entry links to the feedback posts, board items and
// conversations (tickets, error issues) it answers, but its text is its own:
// only what an admin wrote, or what was already public, ever goes out.

import { FEEDBACK_BODY_MAX_LENGTH, FEEDBACK_TITLE_MAX_LENGTH, readDate } from './feedback'
import { safeHttpUrl } from './support'

/** Posts, board items and conversations one entry may link to, each. */
export const CHANGELOG_LINKS_MAX = 50
export const CHANGELOG_VERSION_MAX_LENGTH = 60
export const CHANGELOG_SUMMARY_MAX_LENGTH = 2000
/** Git commits one entry may cite (full 40-hex SHAs). The server skips an entry whose commit an entry already cites. */
export const CHANGELOG_COMMIT_SHAS_MAX = 50
const COMMIT_SHA = /^[0-9a-f]{40}$/

export const CHANGELOG_TAGS = ['new', 'improved', 'fix', 'removed', 'breaking'] as const
export type ChangelogTag = typeof CHANGELOG_TAGS[number]
export const CHANGELOG_TAG_LABELS: Record<ChangelogTag, string> = { new: 'New', improved: 'Improved', fix: 'Fixed', removed: 'Removed', breaking: 'Breaking' }

/** Releases are a draft or published. */
export const CHANGELOG_STATUSES = ['draft', 'published'] as const
export type ChangelogStatus = typeof CHANGELOG_STATUSES[number]

/**
 * An entry can also be archived: retired, never public, but still claiming its
 * slug (the URL keeps 404ing instead of landing on a later entry) and its
 * commits (the CLI never writes a retired commit up again).
 */
export const CHANGELOG_ENTRY_STATUSES = ['draft', 'published', 'archived'] as const
export type ChangelogEntryStatus = typeof CHANGELOG_ENTRY_STATUSES[number]

export const CHANGELOG_BODY_FORMATS = ['markdown', 'html'] as const
export type ChangelogBodyFormat = typeof CHANGELOG_BODY_FORMATS[number]

export const CHANGELOG_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ChangelogReviewStatus = typeof CHANGELOG_REVIEW_STATUSES[number]

/** Who wrote an entry: an operator or admin-token holder, or an automated caller holding the project secret. */
export type ChangelogSourceKind = 'admin' | 'internal'

export const CHANGELOG_SLUG_MAX_LENGTH = 60
export const CHANGELOG_ENTRY_SUMMARY_MAX_LENGTH = 300
export const CHANGELOG_BODY_MAX_LENGTH = FEEDBACK_BODY_MAX_LENGTH
export const CHANGELOG_AREA_MAX_LENGTH = 40
export const CHANGELOG_EXTERNAL_LINKS_MAX = 6
export const CHANGELOG_IMPORT_MAX = 100
export const CHANGELOG_MERGE_MIN = 2
export const CHANGELOG_MERGE_MAX = 10
/** Slugs a route of the API owns, whatever the project says (`/v1/changelog/subscribe` must never be an entry). */
export const CHANGELOG_RESERVED_SLUGS = ['import', 'merge', 'batch', 'subscribe', 'subscription', 'notify', 'comments'] as const

/** A link an entry shows readers (a docs page, a video), not a source it was made from. */
export type ChangelogExternalLink = { label: string, url: string }

export const CHANGELOG_LINK_KINDS = ['feedback', 'board', 'conversation'] as const
export type ChangelogLinkKind = typeof CHANGELOG_LINK_KINDS[number]

// ---- config -----------------------------------------------------------------

export type ChangelogConfig = {
  /** A feedback post or board item reaching a done status drafts an entry (never publishes one). */
  autoDraft: boolean
  /**
   * Serve the public changelog without a feedback board. When false the changelog is public only
   * while the project's feedback board is live with its Changelog option on (how it always was).
   */
  enabled: boolean
  /** Areas an entry may name (`site`, `editor`…). Empty = any area. */
  areas: string[]
  /** Slugs this project's own site routes already use (`confirm`, `rss`…); added to `CHANGELOG_RESERVED_SLUGS`. */
  reservedSlugs: string[]
  /** Readers who are signed in may comment on published entries. */
  comments: boolean
  /** Addresses told when someone comments (never about the team's own comments). */
  commentNotify: string[]
  /** Where an entry lives on the project's own site, for links in emails: `{siteUrl}` and `{slug}` are filled in. */
  entryUrl: string
  /** Subscribers are emailed: an instant mail once a burst of publishes goes quiet, and a weekly digest. Off until a project asks. */
  notify: boolean
  /** The product's name in subjects ("This week on {site}"); the project's own name when empty. */
  siteName: string
  /** The changelog page on the project's own site. */
  pageUrl: string
  /**
   * The pages that confirm a subscription and that unsubscribe (`{token}` is filled in). '' (the
   * default) uses the hosted pages on this server; set them only to send people to your own.
   */
  confirmUrl: string
  unsubscribeUrl: string
  digest: ChangelogDigestConfig
  /** Entries an AI writes from the project's GitHub commits. They start as drafts nobody has approved. */
  commitAi: ChangelogCommitAiConfig
  /** Overrides of the words in the emails; see `DEFAULT_CHANGELOG_COPY` for the keys and what `{site}`, `{count}` and `{window}` become. */
  copy: Record<string, string>
}

export type ChangelogCommitAiConfig = {
  /** A push to a repo's default branch drafts entries from its new commits. */
  onPush: boolean
  /** What a push drafts is published without anyone looking. Off, it waits for review. A generate button press never publishes. */
  autoPublish: boolean
}

export type ChangelogDigestConfig = {
  /** The zone the Monday digest is scheduled in (an IANA name). */
  timezone: string
  /** The hour (0 to 23, local) from Monday on which the weekly digest goes. */
  weeklyHour: number
  /** Minutes without a new publish before the instant mail goes … */
  quietMinutes: number
  /** … and the longest the first publish of a burst waits. */
  maxWaitMinutes: number
}

export const DEFAULT_CHANGELOG_ENTRY_URL = '{siteUrl}/changelog/{slug}'

/** The words of the notification emails, with `{site}`, `{count}` and `{window}` (" (17 Aug – 23 Aug)" or nothing) to fill in. */
export const DEFAULT_CHANGELOG_COPY = {
  instantSubjectMany: "What's new on {site} — {count} updates",
  weeklySubject: 'This week on {site}{window}',
  instantIntroOne: 'We just shipped a change to {site}:',
  instantIntroMany: 'We just shipped {count} changes to {site}:',
  weeklyIntroOne: 'Here is what we shipped this week:',
  weeklyIntroMany: 'Here is what we shipped this week — {count} changes:',
  footerInstant: 'You are getting this because you asked for changelog updates as they happen.',
  footerWeekly: 'You are getting this because you asked for a weekly changelog summary.',
  confirmInstant: 'an email whenever something new ships',
  confirmWeekly: 'a summary at the end of each week'
} as const
export type ChangelogCopyKey = keyof typeof DEFAULT_CHANGELOG_COPY

export const DEFAULT_CHANGELOG_DIGEST: ChangelogDigestConfig = { timezone: 'UTC', weeklyHour: 8, quietMinutes: 30, maxWaitMinutes: 60 }

/** The project's words for an email: its overrides over the defaults. */
export function changelogCopy(config: Pick<ChangelogConfig, 'copy'>): Record<ChangelogCopyKey, string> {
  return { ...DEFAULT_CHANGELOG_COPY, ...Object.fromEntries(Object.entries(config.copy).filter(([key]) => key in DEFAULT_CHANGELOG_COPY)) } as Record<ChangelogCopyKey, string>
}

/** `{name}` placeholders filled in; an unknown one stays as written. */
export function fillChangelogText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole))
}

/** An entry's address on the project's own site, from the config's `entryUrl` template. */
export function fillChangelogUrl(template: string, siteUrl: string, slug: string): string {
  return template.replace('{siteUrl}', siteUrl.replace(/\/+$/, '')).replace('{slug}', encodeURIComponent(slug))
}

/** The address of a page that takes a signed link (`confirmUrl`, `unsubscribeUrl`): `{token}` is filled in. */
export function fillChangelogTokenUrl(template: string, siteUrl: string, token: string): string {
  return template.replace('{siteUrl}', siteUrl.replace(/\/+$/, '')).replace('{token}', encodeURIComponent(token))
}

export const DEFAULT_CHANGELOG_CONFIG: ChangelogConfig = {
  autoDraft: false,
  enabled: false,
  areas: [],
  reservedSlugs: [],
  comments: false,
  commentNotify: [],
  entryUrl: DEFAULT_CHANGELOG_ENTRY_URL,
  notify: false,
  siteName: '',
  pageUrl: '{siteUrl}/changelog',
  confirmUrl: '',
  unsubscribeUrl: '',
  digest: DEFAULT_CHANGELOG_DIGEST,
  commitAi: { onPush: false, autoPublish: false },
  copy: {}
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The link pages' old defaults, on the project's own site, where most projects
 * never built them. Saved configs still carry them; they read as '' (hosted).
 */
const LEGACY_LINK_URLS = new Set(['{siteUrl}/changelog/confirm?token={token}', '{siteUrl}/changelog/unsubscribe?token={token}'])

const KEY = /^[a-z0-9][a-z0-9-]*$/

function record(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
}

function keyList(raw: unknown, label: string, max: number, maxLength: number, errors: string[]): string[] | undefined {
  if (!Array.isArray(raw)) { errors.push(`${label} must be an array`); return undefined }
  const keys = [...new Set(raw.map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean))]
  if (keys.length > max) { errors.push(`${label} holds at most ${max} entries`); return undefined }
  if (!keys.every(key => key.length <= maxLength && KEY.test(key))) { errors.push(`${label} are lowercase letters, digits and hyphens, up to ${maxLength} characters`); return undefined }
  return keys
}

/** Validate a (partial) changelog config on top of `base`: only the keys sent change. */
export function validateChangelogConfig(value: unknown, base: ChangelogConfig = DEFAULT_CHANGELOG_CONFIG): { config: ChangelogConfig, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('changelog must be an object')
  const raw = record(value)
  const config: ChangelogConfig = { ...base, areas: [...base.areas], reservedSlugs: [...base.reservedSlugs], commentNotify: [...base.commentNotify], digest: { ...base.digest }, commitAi: { ...base.commitAi }, copy: { ...base.copy } }
  if (raw.autoDraft !== undefined) config.autoDraft = Boolean(raw.autoDraft)
  if (raw.enabled !== undefined) config.enabled = Boolean(raw.enabled)
  if (raw.comments !== undefined) config.comments = Boolean(raw.comments)
  if (raw.commentNotify !== undefined) {
    const emails = Array.isArray(raw.commentNotify) ? [...new Set(raw.commentNotify.map(v => String(v ?? '').trim().toLowerCase()).filter(Boolean))] : null
    if (!emails || emails.length > 5 || !emails.every(email => email.length <= 200 && EMAIL.test(email))) errors.push('commentNotify is a list of up to 5 email addresses')
    else config.commentNotify = emails
  }
  if (raw.notify !== undefined) config.notify = Boolean(raw.notify)
  if (raw.commitAi !== undefined) {
    const c = record(raw.commitAi)
    if (c.onPush !== undefined) config.commitAi.onPush = Boolean(c.onPush)
    if (c.autoPublish !== undefined) config.commitAi.autoPublish = Boolean(c.autoPublish)
  }
  if (raw.siteName !== undefined) {
    if (typeof raw.siteName !== 'string' || raw.siteName.trim().length > 80) errors.push('siteName is up to 80 characters')
    else config.siteName = raw.siteName.trim()
  }
  for (const [key, needs] of [['pageUrl', ''], ['confirmUrl', '{token}'], ['unsubscribeUrl', '{token}']] as const) {
    if (raw[key] === undefined) continue
    const url = typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''
    // The link pages may be cleared: '' sends people to the hosted ones.
    if (needs && (!url || LEGACY_LINK_URLS.has(url))) { config[key as 'confirmUrl' | 'unsubscribeUrl'] = ''; continue }
    if (!url || url.length > 300 || (needs && !url.includes(needs)) || !/^(https?:\/\/|\{siteUrl\})/.test(url)) errors.push(`${key} must be an http(s) URL (or start with {siteUrl})${needs ? ` containing ${needs}, or '' for the hosted page` : ''}`)
    else config[key] = url
  }
  if (raw.digest !== undefined) {
    const d = record(raw.digest)
    const next = { ...config.digest }
    if (d.timezone !== undefined) {
      const zone = typeof d.timezone === 'string' ? d.timezone.trim() : ''
      let valid = Boolean(zone)
      try { if (zone) new Intl.DateTimeFormat('en', { timeZone: zone }) } catch { valid = false }
      if (valid) next.timezone = zone
      else errors.push('digest.timezone must be an IANA time zone, like Europe/Madrid')
    }
    const whole = (value: unknown, label: string, min: number, max: number, assign: (n: number) => void) => {
      if (value === undefined) return
      if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) assign(value)
      else errors.push(`digest.${label} must be a whole number from ${min} to ${max}`)
    }
    whole(d.weeklyHour, 'weeklyHour', 0, 23, n => { next.weeklyHour = n })
    whole(d.quietMinutes, 'quietMinutes', 1, 1440, n => { next.quietMinutes = n })
    whole(d.maxWaitMinutes, 'maxWaitMinutes', 1, 1440, n => { next.maxWaitMinutes = n })
    if (next.maxWaitMinutes < next.quietMinutes) errors.push('digest.maxWaitMinutes cannot be shorter than quietMinutes')
    else config.digest = next
  }
  if (raw.copy !== undefined) {
    const copy = record(raw.copy)
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(copy)) {
      if (!(key in DEFAULT_CHANGELOG_COPY)) errors.push(`copy.${key} is not one of ${Object.keys(DEFAULT_CHANGELOG_COPY).join(', ')}`)
      else if (typeof value !== 'string' || !value.trim() || value.length > 300) errors.push(`copy.${key} is 1 to 300 characters`)
      else next[key] = value.trim()
    }
    if (!errors.some(error => error.startsWith('copy.'))) config.copy = { ...config.copy, ...next }
  }
  if (raw.entryUrl !== undefined) {
    const url = typeof raw.entryUrl === 'string' ? raw.entryUrl.trim() : ''
    if (!url || url.length > 300 || !url.includes('{slug}') || !/^(https?:\/\/|\{siteUrl\})/.test(url)) errors.push('entryUrl must be an http(s) URL (or start with {siteUrl}) containing {slug}')
    else config.entryUrl = url
  }
  if (raw.areas !== undefined) config.areas = keyList(raw.areas, 'areas', 30, CHANGELOG_AREA_MAX_LENGTH, errors) ?? config.areas
  if (raw.reservedSlugs !== undefined) config.reservedSlugs = keyList(raw.reservedSlugs, 'reservedSlugs', 50, CHANGELOG_SLUG_MAX_LENGTH, errors) ?? config.reservedSlugs
  return { config, errors }
}

/** Read a stored config leniently. */
export function normalizeChangelogConfig(value: unknown): ChangelogConfig {
  return validateChangelogConfig(value).config
}

/** The slugs an entry of this project may not take. */
export function changelogReservedSlugs(config: ChangelogConfig): Set<string> {
  return new Set([...CHANGELOG_RESERVED_SLUGS, ...config.reservedSlugs])
}

// ---- comments ---------------------------------------------------------------

/**
 * `hidden` is moderation (the comment stays in an admin's view, marked);
 * `deleted` is removal (nobody sees it; the row survives for the audit trail).
 */
export const CHANGELOG_COMMENT_STATUSES = ['visible', 'hidden', 'deleted'] as const
export type ChangelogCommentStatus = typeof CHANGELOG_COMMENT_STATUSES[number]

/** Source characters: generous for a paragraph or two, small enough that a runaway paste can't bloat the class. */
export const CHANGELOG_COMMENT_MAX_LENGTH = 4000
/** Plain-text characters after rendering: "ok" is a comment, a lone bullet is not. */
export const CHANGELOG_COMMENT_MIN_TEXT = 2
/** A genuine comment linking six things is rarer than a link farm. */
export const CHANGELOG_COMMENT_LINKS_MAX = 6
export const CHANGELOG_COMMENTS_PAGE_MAX = 100

/** A reader's comment on a published entry. */
export type ChangelogComment = {
  id: string
  entryId: string
  entrySlug: string
  /** The author's Markdown, verbatim: what reopens in the editor. */
  body: string
  /** Sanitised HTML, rendered once on write. */
  bodyHtml: string
  status: ChangelogCommentStatus
  /** The host's id for the author (the identity token's `sub`). */
  authorId: string
  authorName: string
  authorAvatar: string | null
  /** True when the author was an admin when they wrote it. */
  authorIsStaff: boolean
  createdAt: string
  updatedAt: string
  editedAt: string | null
  /** Whether the viewer wrote it. Per request, never stored. */
  viewerIsAuthor: boolean
}

export type ChangelogCommentPage = { comments: ChangelogComment[], total: number, hasMore: boolean }

/** The body of a comment create/update: `body` is the author's, `status` a moderator's. */
export function readChangelogCommentInput(payload: unknown): { body?: string, status?: ChangelogCommentStatus, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const out: { body?: string, status?: ChangelogCommentStatus } = {}
  if (raw.body !== undefined) {
    if (typeof raw.body !== 'string') errors.push('body must be a string')
    else out.body = raw.body
  }
  if (raw.status !== undefined) {
    if ((CHANGELOG_COMMENT_STATUSES as readonly string[]).includes(String(raw.status))) out.status = raw.status as ChangelogCommentStatus
    else errors.push(`status must be one of ${CHANGELOG_COMMENT_STATUSES.join(', ')}`)
  }
  return { ...out, errors }
}

export type ChangelogCommentImportValues = {
  externalId: string
  /** The entry it is on: its `externalId`, slug or `#N`. */
  entry: string
  body: string
  status: ChangelogCommentStatus
  authorId: string
  authorName: string
  authorAvatar: string
  authorIsStaff: boolean
  postedAt: Date | null
  editedAt: Date | null
}

/** One item of `POST …/comments/import`: a comment as another system has it. */
export function readChangelogCommentImportItem(payload: unknown): { values: ChangelogCommentImportValues, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const externalId = text(raw.externalId, 200)
  const entry = text(raw.entry, 200)
  if (!externalId) errors.push('externalId is required')
  if (!entry) errors.push('entry is required')
  const status = raw.status === undefined ? 'visible' : raw.status
  if (!(CHANGELOG_COMMENT_STATUSES as readonly string[]).includes(String(status))) errors.push(`status must be one of ${CHANGELOG_COMMENT_STATUSES.join(', ')}`)
  const body = typeof raw.body === 'string' ? raw.body : ''
  if (body.length > CHANGELOG_COMMENT_MAX_LENGTH) errors.push(`body is longer than ${CHANGELOG_COMMENT_MAX_LENGTH} characters`)
  const postedAt = raw.postedAt === undefined ? null : readDate(raw.postedAt, 'postedAt', errors) ?? null
  const editedAt = raw.editedAt === undefined ? null : readDate(raw.editedAt, 'editedAt', errors) ?? null
  return {
    values: {
      externalId,
      entry,
      body,
      status: status as ChangelogCommentStatus,
      authorId: text(raw.authorId, 200),
      authorName: text(raw.authorName, 120),
      authorAvatar: safeHttpUrl(raw.authorAvatar),
      authorIsStaff: raw.authorIsStaff === true,
      postedAt,
      editedAt
    },
    errors
  }
}

// ---- subscriptions ------------------------------------------------------------

export const CHANGELOG_FREQUENCIES = ['instant', 'weekly'] as const
export type ChangelogFrequency = typeof CHANGELOG_FREQUENCIES[number]
export const CHANGELOG_SUBSCRIPTION_STATUSES = ['pending', 'active', 'unsubscribed'] as const
export type ChangelogSubscriptionStatus = typeof CHANGELOG_SUBSCRIPTION_STATUSES[number]
export const CHANGELOG_IMPORT_SUBSCRIPTIONS_MAX = 500

export function normalizeSubscriberEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isSubscriberEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value)
}

/**
 * The body of `POST /v1/changelog/subscribe`: how often, or `off` (a signed-in
 * user turning it off), and an email when nobody is signed in. `email` is read
 * as sent; whether it is needed depends on who is asking.
 */
export function readChangelogSubscribeInput(payload: unknown): { frequency: ChangelogFrequency | 'off', email: string, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const frequency = raw.frequency === 'off' || (CHANGELOG_FREQUENCIES as readonly string[]).includes(String(raw.frequency)) ? raw.frequency as ChangelogFrequency | 'off' : null
  if (!frequency) errors.push(`frequency must be one of ${CHANGELOG_FREQUENCIES.join(', ')}, or off`)
  const email = normalizeSubscriberEmail(raw.email)
  if (raw.email !== undefined && raw.email !== null && raw.email !== '' && !isSubscriberEmail(email)) errors.push('email is not a valid address')
  return { frequency: frequency ?? 'instant', email, errors }
}

/** A signed link's token, from the body or (the one-click form mail providers POST) the query. */
export function readChangelogTokenInput(payload: unknown, queryToken?: unknown): string {
  const fromBody = record(payload).token
  const token = typeof fromBody === 'string' && fromBody ? fromBody : typeof queryToken === 'string' ? queryToken : ''
  return token.trim().slice(0, 500)
}

export function readChangelogNotifyRunInput(payload: unknown): { job: 'instant' | 'weekly' | null, dryRun: boolean, now: Date | null, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  // `now` runs the beat as of another moment: a catch-up after downtime, or a test.
  const now = raw.now === undefined || raw.now === null ? null : readDate(raw.now, 'now', errors) ?? null
  return { job: raw.job === 'instant' || raw.job === 'weekly' ? raw.job : null, dryRun: raw.dryRun === true, now, errors }
}

export type ChangelogSubscriptionImportValues = {
  externalId: string
  email: string
  userId: string
  displayName: string
  frequency: ChangelogFrequency
  pendingFrequency: ChangelogFrequency | null
  status: ChangelogSubscriptionStatus
  source: 'user' | 'anonymous'
  confirmedAt: Date | null
  unsubscribedAt: Date | null
  confirmSentAt: Date | null
}

/** One subscription as another system has it (`POST …/subscriptions/import`). */
export function readChangelogSubscriptionImportItem(payload: unknown): { values: ChangelogSubscriptionImportValues, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const email = normalizeSubscriberEmail(raw.email)
  if (!isSubscriberEmail(email)) errors.push('email is not a valid address')
  const externalId = text(raw.externalId, 200)
  if (!externalId) errors.push('externalId is required')
  const frequency = raw.frequency === undefined ? 'instant' : raw.frequency
  if (!(CHANGELOG_FREQUENCIES as readonly string[]).includes(String(frequency))) errors.push(`frequency must be one of ${CHANGELOG_FREQUENCIES.join(', ')}`)
  const status = raw.status === undefined ? 'active' : raw.status
  if (!(CHANGELOG_SUBSCRIPTION_STATUSES as readonly string[]).includes(String(status))) errors.push(`status must be one of ${CHANGELOG_SUBSCRIPTION_STATUSES.join(', ')}`)
  const pending = raw.pendingFrequency === undefined || raw.pendingFrequency === null ? null : raw.pendingFrequency
  if (pending !== null && !(CHANGELOG_FREQUENCIES as readonly string[]).includes(String(pending))) errors.push('pendingFrequency must be instant or weekly')
  const date = (value: unknown, label: string) => (value === undefined || value === null ? null : readDate(value, label, errors) ?? null)
  return {
    values: {
      externalId,
      email,
      userId: text(raw.userId, 200),
      displayName: text(raw.displayName, 120),
      frequency: frequency as ChangelogFrequency,
      pendingFrequency: pending as ChangelogFrequency | null,
      status: status as ChangelogSubscriptionStatus,
      source: raw.source === 'user' ? 'user' : 'anonymous',
      confirmedAt: date(raw.confirmedAt, 'confirmedAt'),
      unsubscribedAt: date(raw.unsubscribedAt, 'unsubscribedAt'),
      confirmSentAt: date(raw.confirmSentAt, 'confirmSentAt')
    },
    errors
  }
}

/** A past send, so an import does not make the first sweep resend a week (`POST …/subscriptions/import`'s `runs`). */
export type ChangelogRunImportValues = { kind: 'instant' | 'weekly', windowStart: Date | null, windowEnd: Date | null, finishedAt: Date | null }

export function readChangelogRunImportItem(payload: unknown): { values: ChangelogRunImportValues, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const kind = raw.kind === 'instant' || raw.kind === 'weekly' ? raw.kind : null
  if (!kind) errors.push('kind must be instant or weekly')
  const date = (value: unknown, label: string) => (value === undefined || value === null ? null : readDate(value, label, errors) ?? null)
  return { values: { kind: kind ?? 'weekly', windowStart: date(raw.windowStart, 'windowStart'), windowEnd: date(raw.windowEnd, 'windowEnd'), finishedAt: date(raw.finishedAt, 'finishedAt') }, errors }
}

// ---- wire types -------------------------------------------------------------

/** What an entry links to, resolved for the panel. Admin only. */
export type ChangelogSource = {
  kind: ChangelogLinkKind
  id: string
  number: number | null
  label: string
  status: string
  /** The source is finished: a done post or item, a resolved or closed conversation. */
  done: boolean
}

/** An entry as the panel (and operators, admin tokens and the project secret) see it. */
export type ChangelogEntry = {
  id: string
  projectId: string
  number: number | null
  /** The entry's URL key: stable, unique in the project, claimed even once archived. */
  slug: string
  title: string
  /** One or two sentences for list cards and previews. */
  summary: string
  /** What was written: Markdown (the default) or HTML. */
  body: string
  bodyFormat: ChangelogBodyFormat
  /** `body` rendered and sanitised once, on write. Safe to put in a page as it is. */
  bodyHtml: string
  /** A plain-text lead-in derived from the body. */
  excerpt: string
  tag: ChangelogTag
  /** The part of the product it touches; '' when unset. */
  area: string
  /** '' when the entry belongs to no release. */
  releaseId: string
  /** The release's version; '' when it has no release. */
  version: string
  status: ChangelogEntryStatus
  publishedAt: string | null
  pinned: boolean
  iconGlyph: string
  accentColor: string
  imageUrl: string
  links: ChangelogExternalLink[]
  feedbackPostIds: string[]
  boardItemIds: string[]
  conversationIds: string[]
  /** Git commits this entry describes (full SHAs), set by the CLI; what stops one commit being written up twice. Admin only. */
  commitShas: string[]
  /** The caller's own id for this entry (an import's key). Admin only. */
  externalId: string
  /** Review of a draft: null for an entry that was never a draft. */
  reviewStatus: ChangelogReviewStatus | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  authorName: string
  source: ChangelogSourceKind | null
  /** Written by AI from git commits. Stays true after a person edits or approves it. */
  aiGenerated: boolean
  /** Visible comments, kept by the comments feature. */
  commentCount: number
  /** Linked sources that still exist. */
  sources: ChangelogSource[]
  createdAt: string
  updatedAt: string
}

export type ChangelogRelease = {
  id: string
  projectId: string
  version: string
  title: string
  summary: string
  status: ChangelogStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** An entry as the public sees it: an allow-list, nothing about its sources. */
export type PublicChangelogEntry = {
  id: string
  number: number | null
  slug: string
  title: string
  summary: string
  body: string
  bodyFormat: ChangelogBodyFormat
  bodyHtml: string
  excerpt: string
  tag: ChangelogTag
  area: string
  /** The version of the release it belongs to; '' when it has none. */
  version: string
  pinned: boolean
  iconGlyph: string
  accentColor: string
  imageUrl: string
  links: ChangelogExternalLink[]
  commentCount: number
  authorName: string
  publishedAt: string | null
  updatedAt: string
}

export type PublicChangelogRelease = {
  id: string
  version: string
  title: string
  summary: string
  publishedAt: string | null
  entries: PublicChangelogEntry[]
}

export type PublicChangelog = {
  /** Published releases that have a published entry, newest first. */
  releases: PublicChangelogRelease[]
  /** Published entries that belong to no release, newest first. */
  entries: PublicChangelogEntry[]
}

/** A page of published entries, newest first, each carrying its release's version. */
export type PublicChangelogPage = {
  entries: PublicChangelogEntry[]
  total: number
  hasMore: boolean
}

// ---- input ------------------------------------------------------------------

function longText(raw: unknown, label: string, max: number, errors: string[]): string | undefined {
  if (raw === null) return ''
  if (typeof raw !== 'string') { errors.push(`${label} must be a string`); return undefined }
  if (raw.length > max) { errors.push(`${label} is longer than ${max} characters`); return undefined }
  return raw.trim()
}

function readTitle(raw: unknown, label: string, max: number, errors: string[]): string | undefined {
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (!title) { errors.push(`${label} is required`); return undefined }
  if (title.length > max) { errors.push(`${label} is longer than ${max} characters`); return undefined }
  return title
}

export function isChangelogTag(value: unknown): value is ChangelogTag {
  return (CHANGELOG_TAGS as readonly string[]).includes(String(value))
}

function isChangelogStatus(value: unknown): value is ChangelogStatus {
  return (CHANGELOG_STATUSES as readonly string[]).includes(String(value))
}

export function isChangelogEntryStatus(value: unknown): value is ChangelogEntryStatus {
  return (CHANGELOG_ENTRY_STATUSES as readonly string[]).includes(String(value))
}

export type ChangelogEntryValues = Partial<{
  title: string
  /** What the author asked for; the server turns it into a unique slug. */
  slug: string
  summary: string
  body: string
  bodyFormat: ChangelogBodyFormat
  tag: ChangelogTag
  area: string
  status: ChangelogEntryStatus
  publishedAt: Date | null
  /** null (or '') takes the entry out of its release. Checked against the project by the server. */
  releaseId: string | null
  /** The release by its version: found, or created already published. Ignored when `releaseId` is sent. */
  releaseVersion: string
  commitShas: string[]
  pinned: boolean
  iconGlyph: string
  accentColor: string
  imageUrl: string
  links: ChangelogExternalLink[]
}>

function readLinks(raw: unknown, errors: string[]): ChangelogExternalLink[] | undefined {
  if (!Array.isArray(raw) || raw.length > CHANGELOG_EXTERNAL_LINKS_MAX) { errors.push(`links must be an array of at most ${CHANGELOG_EXTERNAL_LINKS_MAX} links`); return undefined }
  const links: ChangelogExternalLink[] = []
  for (const item of raw) {
    const label = String(record(item).label ?? '').trim()
    const url = safeHttpUrl(record(item).url)
    if (!label || label.length > 80 || !url || url.length > 500) { errors.push('every link needs a label (up to 80 characters) and an http(s) url (up to 500)'); return undefined }
    links.push({ label, url })
  }
  return links
}

/** Read a create/update body for an entry. Anything present but malformed is reported. */
export function readChangelogEntryInput(payload: unknown, options: { create: boolean }): { values: ChangelogEntryValues, errors: string[] } {
  const raw = record(payload)
  const values: ChangelogEntryValues = {}
  const errors: string[] = []
  const has = (key: string) => raw[key] !== undefined

  if (has('title') || options.create) {
    const title = readTitle(raw.title, 'A title', FEEDBACK_TITLE_MAX_LENGTH, errors)
    if (title !== undefined) values.title = title
  }
  if (has('slug')) {
    if (typeof raw.slug !== 'string' || raw.slug.length > 120) errors.push('slug must be a string of up to 120 characters')
    else if (raw.slug.trim()) values.slug = raw.slug.trim()
  }
  if (has('summary')) {
    const summary = longText(raw.summary, 'summary', CHANGELOG_ENTRY_SUMMARY_MAX_LENGTH, errors)
    if (summary !== undefined) values.summary = summary
  }
  if (has('body')) {
    const body = longText(raw.body, 'body', CHANGELOG_BODY_MAX_LENGTH, errors)
    if (body !== undefined) values.body = body
  }
  if (has('bodyFormat')) {
    if ((CHANGELOG_BODY_FORMATS as readonly string[]).includes(String(raw.bodyFormat))) values.bodyFormat = raw.bodyFormat as ChangelogBodyFormat
    else errors.push(`bodyFormat must be one of ${CHANGELOG_BODY_FORMATS.join(', ')}`)
  }
  if (has('tag')) {
    if (isChangelogTag(raw.tag)) values.tag = raw.tag
    else errors.push(`tag must be one of ${CHANGELOG_TAGS.join(', ')}`)
  } else if (options.create) values.tag = 'improved'
  if (has('area')) {
    const area = raw.area === null ? '' : String(raw.area).trim().toLowerCase()
    if (area && (area.length > CHANGELOG_AREA_MAX_LENGTH || !KEY.test(area))) errors.push(`area is lowercase letters, digits and hyphens, up to ${CHANGELOG_AREA_MAX_LENGTH} characters`)
    else values.area = area
  }
  if (has('status')) {
    if (isChangelogEntryStatus(raw.status)) values.status = raw.status
    else errors.push(`status must be one of ${CHANGELOG_ENTRY_STATUSES.join(', ')}`)
  } else if (options.create) values.status = 'draft'
  if (has('publishedAt')) {
    const date = readDate(raw.publishedAt, 'publishedAt', errors)
    if (date !== undefined) values.publishedAt = date
  }
  if (has('releaseId')) {
    if (raw.releaseId !== null && typeof raw.releaseId !== 'string') errors.push('releaseId must be a string')
    else values.releaseId = String(raw.releaseId || '').trim().slice(0, 40) || null
  }
  if (has('releaseVersion') && raw.releaseVersion !== null) {
    const version = typeof raw.releaseVersion === 'string' ? raw.releaseVersion.trim() : ''
    if (!version || version.length > CHANGELOG_VERSION_MAX_LENGTH) errors.push(`releaseVersion is required, up to ${CHANGELOG_VERSION_MAX_LENGTH} characters`)
    else values.releaseVersion = version
  }
  if (has('commitShas')) {
    const shas = Array.isArray(raw.commitShas) ? raw.commitShas.map(sha => String(sha).trim().toLowerCase()) : null
    if (!shas || shas.length > CHANGELOG_COMMIT_SHAS_MAX || !shas.every(sha => COMMIT_SHA.test(sha))) errors.push(`commitShas must be an array of at most ${CHANGELOG_COMMIT_SHAS_MAX} full 40-character commit SHAs`)
    else values.commitShas = [...new Set(shas)]
  }
  if (has('pinned')) {
    if (typeof raw.pinned === 'boolean') values.pinned = raw.pinned
    else errors.push('pinned must be true or false')
  }
  if (has('iconGlyph')) {
    const glyph = longText(raw.iconGlyph, 'iconGlyph', 80, errors)
    if (glyph !== undefined) values.iconGlyph = glyph
  }
  if (has('accentColor')) {
    const color = raw.accentColor === null ? '' : String(raw.accentColor).trim()
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) errors.push('accentColor must be a #rrggbb colour')
    else values.accentColor = color
  }
  if (has('imageUrl')) {
    const url = raw.imageUrl === null || raw.imageUrl === '' ? '' : safeHttpUrl(raw.imageUrl)
    if (raw.imageUrl && (!url || url.length > 500)) errors.push('imageUrl must be an http(s) url of up to 500 characters')
    else values.imageUrl = url
  }
  if (has('links')) {
    const links = raw.links === null ? [] : readLinks(raw.links, errors)
    if (links !== undefined) values.links = links
  }
  return { values, errors }
}

export type ChangelogReleaseValues = Partial<{
  version: string
  title: string
  summary: string
  status: ChangelogStatus
  publishedAt: Date | null
}>

export function readChangelogReleaseInput(payload: unknown, options: { create: boolean }): { values: ChangelogReleaseValues, errors: string[] } {
  const raw = record(payload)
  const values: ChangelogReleaseValues = {}
  const errors: string[] = []
  const has = (key: string) => raw[key] !== undefined

  if (has('version') || options.create) {
    const version = readTitle(raw.version, 'A version', CHANGELOG_VERSION_MAX_LENGTH, errors)
    if (version !== undefined) values.version = version
  }
  if (has('title')) {
    const title = longText(raw.title, 'title', FEEDBACK_TITLE_MAX_LENGTH, errors)
    if (title !== undefined) values.title = title
  }
  if (has('summary')) {
    const summary = longText(raw.summary, 'summary', CHANGELOG_SUMMARY_MAX_LENGTH, errors)
    if (summary !== undefined) values.summary = summary
  }
  if (has('status')) {
    if (isChangelogStatus(raw.status)) values.status = raw.status
    else errors.push(`status must be one of ${CHANGELOG_STATUSES.join(', ')}`)
  } else if (options.create) values.status = 'draft'
  if (has('publishedAt')) {
    const date = readDate(raw.publishedAt, 'publishedAt', errors)
    if (date !== undefined) values.publishedAt = date
  }
  return { values, errors }
}

/** The body of `POST …/entries/:id/review`. */
export function readChangelogReviewInput(payload: unknown): { action: 'approve' | 'reject', notes: string, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const action = raw.action === 'approve' || raw.action === 'reject' ? raw.action : null
  if (!action) errors.push('action must be approve or reject')
  const notes = raw.notes === undefined || raw.notes === null ? '' : longText(raw.notes, 'notes', 2000, errors) ?? ''
  return { action: action ?? 'approve', notes, errors }
}

/** The body of `POST …/entries/merge`: the entries to fold together (slugs, `#N` or ids) and the merged entry. */
export function readChangelogMergeInput(payload: unknown): { refs: string[], entry: Record<string, unknown>, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const refs = Array.isArray(raw.refs) ? [...new Set(raw.refs.map(ref => String(ref ?? '').trim().replace(/^#/, '')).filter(Boolean))] : []
  if (refs.length < CHANGELOG_MERGE_MIN || refs.length > CHANGELOG_MERGE_MAX) errors.push(`refs must name ${CHANGELOG_MERGE_MIN} to ${CHANGELOG_MERGE_MAX} entries`)
  if (!raw.entry || typeof raw.entry !== 'object' || Array.isArray(raw.entry)) errors.push('entry (the merged entry) is required')
  return { refs, entry: record(raw.entry), errors }
}

export type ChangelogImportValues = ChangelogEntryValues & Partial<{
  reviewStatus: ChangelogReviewStatus | null
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNotes: string | null
  authorName: string
  source: ChangelogSourceKind
  /** When subscribers were told about it, if they were. */
  notifiedAt: Date | null
}>

/**
 * One item of `POST …/entries/import`: an entry as `readChangelogEntryInput`
 * takes it (update rules: only what is sent), plus the caller's `externalId`
 * and the review trail the entry already has. The server applies the create
 * defaults (a title is then required) only to an entry it has not seen.
 */
export function readChangelogImportItem(payload: unknown): { externalId: string, values: ChangelogImportValues, errors: string[] } {
  const raw = record(payload)
  const { values, errors } = readChangelogEntryInput(raw, { create: false })
  const out: ChangelogImportValues = { ...values }
  const externalId = typeof raw.externalId === 'string' ? raw.externalId.trim() : ''
  if (!externalId || externalId.length > 200) errors.push('externalId is required, up to 200 characters')
  if (raw.reviewStatus !== undefined) {
    if (raw.reviewStatus === null || (CHANGELOG_REVIEW_STATUSES as readonly string[]).includes(String(raw.reviewStatus))) out.reviewStatus = raw.reviewStatus as ChangelogReviewStatus | null
    else errors.push(`reviewStatus must be one of ${CHANGELOG_REVIEW_STATUSES.join(', ')}`)
  }
  if (raw.reviewedBy !== undefined) out.reviewedBy = raw.reviewedBy === null ? null : String(raw.reviewedBy).slice(0, 120)
  if (raw.reviewedAt !== undefined) {
    const date = readDate(raw.reviewedAt, 'reviewedAt', errors)
    if (date !== undefined) out.reviewedAt = date
  }
  if (raw.reviewNotes !== undefined) out.reviewNotes = raw.reviewNotes === null ? null : String(raw.reviewNotes).slice(0, 2000)
  if (raw.notifiedAt !== undefined) {
    const date = raw.notifiedAt === null ? null : readDate(raw.notifiedAt, 'notifiedAt', errors)
    if (date !== undefined) out.notifiedAt = date
  }
  if (raw.authorName !== undefined) out.authorName = String(raw.authorName ?? '').trim().slice(0, 120)
  if (raw.source !== undefined) {
    if (raw.source === 'admin' || raw.source === 'internal') out.source = raw.source
    else errors.push('source must be admin or internal')
  }
  return { externalId, values: out, errors }
}

// ---- what goes public --------------------------------------------------------

/** Public iff the entry is published and its release, when it has one, is too. An archived entry never is. */
export function isEntryPublic(entry: { status: string }, release: { status: string } | null): boolean {
  return entry.status === 'published' && (!release || release.status === 'published')
}

/** The fields an entry shows the public; a field added to ChangelogEntry never leaks by default. */
export type PublicEntrySource = Pick<ChangelogEntry,
  'id' | 'number' | 'slug' | 'title' | 'summary' | 'body' | 'bodyFormat' | 'bodyHtml' | 'excerpt' | 'tag' | 'area' | 'pinned'
  | 'iconGlyph' | 'accentColor' | 'imageUrl' | 'links' | 'commentCount' | 'authorName' | 'publishedAt' | 'updatedAt'>

/** The public shape of an entry: an allow-list. `version` is its release's, '' when it has none. */
export function toPublicEntry(entry: PublicEntrySource, version = ''): PublicChangelogEntry {
  return {
    id: entry.id,
    number: entry.number,
    slug: entry.slug,
    title: entry.title,
    summary: entry.summary,
    body: entry.body,
    bodyFormat: entry.bodyFormat,
    bodyHtml: entry.bodyHtml,
    excerpt: entry.excerpt,
    tag: entry.tag,
    area: entry.area,
    version,
    pinned: entry.pinned,
    iconGlyph: entry.iconGlyph,
    accentColor: entry.accentColor,
    imageUrl: entry.imageUrl,
    links: entry.links,
    commentCount: entry.commentCount,
    authorName: entry.authorName,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt
  }
}

function newestFirst(a: { publishedAt: string | null }, b: { publishedAt: string | null }): number {
  return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
}

/** Entries as the public list wants them: newest first, the higher number first among equals. */
export function sortEntriesNewestFirst<T extends { publishedAt: string | null, number: number | null }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => newestFirst(a, b) || Number(b.number || 0) - Number(a.number || 0))
}

type EntryForGrouping = PublicEntrySource & Pick<ChangelogEntry, 'status' | 'releaseId'>

/**
 * The public changelog from every release and entry of a project (any status):
 * applies `isEntryPublic`, groups entries under their release, and drops
 * releases with nothing published in them.
 */
export function buildPublicChangelog(
  releases: Pick<ChangelogRelease, 'id' | 'version' | 'title' | 'summary' | 'status' | 'publishedAt'>[],
  entries: EntryForGrouping[]
): PublicChangelog {
  const byId = new Map(releases.map(release => [release.id, release]))
  const grouped = new Map<string, PublicChangelogEntry[]>()
  const unreleased: PublicChangelogEntry[] = []

  for (const entry of sortEntriesNewestFirst(entries)) {
    if (!entry.releaseId) {
      if (isEntryPublic(entry, null)) unreleased.push(toPublicEntry(entry))
      continue
    }
    const release = byId.get(entry.releaseId)
    if (!release || !isEntryPublic(entry, release)) continue
    const list = grouped.get(release.id) || []
    list.push(toPublicEntry(entry, release.version))
    grouped.set(release.id, list)
  }

  const out = releases
    .filter(release => release.status === 'published' && grouped.has(release.id))
    .sort(newestFirst)
    .map(release => ({ id: release.id, version: release.version, title: release.title, summary: release.summary, publishedAt: release.publishedAt, entries: grouped.get(release.id)! }))
  return { releases: out, entries: unreleased }
}

export type ChangelogTimelineItem
  = { kind: 'release', date: string | null, release: PublicChangelogRelease }
  | { kind: 'entry', date: string | null, entry: PublicChangelogEntry }

/** Releases and release-less entries as one list, newest first (a release before an entry of the same date). */
export function changelogTimeline(changelog: PublicChangelog): ChangelogTimelineItem[] {
  const items: ChangelogTimelineItem[] = [
    ...changelog.releases.map(release => ({ kind: 'release' as const, date: release.publishedAt, release })),
    ...changelog.entries.map(entry => ({ kind: 'entry' as const, date: entry.publishedAt, entry }))
  ]
  return items.sort((a, b) => newestFirst({ publishedAt: a.date }, { publishedAt: b.date }) || (a.kind === b.kind ? 0 : a.kind === 'release' ? -1 : 1))
}

// ---- creating an entry from a source -----------------------------------------

export type ChangelogPrefill = { title: string, body: string, tag: ChangelogTag }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * What a new entry starts with, from the thing it is made from. Only text that
 * is already public is copied: a post's own changelog text or text, a board
 * item's *public* description. A conversation (ticket or error issue) gives
 * nothing but a tag — never its messages, subject or stack trace. Reads known
 * keys only, so a source carrying more never leaks it.
 */
export function changelogPrefill(kind: ChangelogLinkKind, source: Record<string, unknown>): ChangelogPrefill {
  if (kind === 'feedback') {
    const type = text(source.type)
    return {
      title: text(source.changelogTitle) || text(source.title),
      body: text(source.changelogBody) || text(source.body),
      tag: type === 'bug' ? 'fix' : type === 'feature' ? 'new' : 'improved'
    }
  }
  if (kind === 'board') return { title: text(source.title), body: text(source.publicDescription), tag: 'improved' }
  return { title: '', body: '', tag: text(source.type) === 'error' ? 'fix' : 'improved' }
}
