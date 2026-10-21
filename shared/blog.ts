// The blog: long-form posts a project publishes on its own hosted page, in an
// RSS feed and, on a plan with campaigns, as a newsletter to its subscribers.
// Readers react to posts and comment on them. Shared by the API, the panel and
// the embed; the constants the native app needs are ported to Swift
// (tests/blogNativeParity.test.ts keeps them equal).

import { readDate } from './feedback'
import { safeHttpUrl } from './support'

export const BLOG_TITLE_MAX_LENGTH = 200
export const BLOG_SLUG_MAX_LENGTH = 80
export const BLOG_EXCERPT_MAX_LENGTH = 300
/** Markdown source characters: a long essay with room to spare. */
export const BLOG_BODY_MAX_LENGTH = 100_000
export const BLOG_TAGS_MAX = 10
export const BLOG_TAG_MAX_LENGTH = 40
export const BLOG_PAGE_MAX = 50
/** What a reader reads per minute, for "5 min read". */
export const BLOG_WORDS_PER_MINUTE = 220

/**
 * Slugs a route owns, whatever the post is called: `/v1/blog/comments/:id`
 * must never be a post's comment thread, and `rss` is what people guess for a feed.
 */
export const BLOG_RESERVED_SLUGS = ['comments', 'rss', 'feed', 'tags', 'subscribe'] as const

/**
 * A post is a draft or published. A published post whose `publishedAt` is
 * still ahead is scheduled: it goes public on its own at that moment.
 */
export const BLOG_POST_STATUSES = ['draft', 'published'] as const
export type BlogPostStatus = typeof BLOG_POST_STATUSES[number]

/** The reactions a reader may leave on a post, in the order they show. */
export const BLOG_REACTIONS = ['heart', '+1', 'hooray', 'laugh', 'rocket', 'eyes'] as const
export type BlogReactionKey = typeof BLOG_REACTIONS[number]
export const BLOG_REACTION_EMOJI: Record<BlogReactionKey, string> = { 'heart': '❤️', '+1': '👍', 'hooray': '🎉', 'laugh': '😄', 'rocket': '🚀', 'eyes': '👀' }
export type BlogReactionSummary = { key: BlogReactionKey, count: number, reacted?: boolean }

/** `hidden` is moderation (the team still sees it, marked); `deleted` is removal (nobody does). */
export const BLOG_COMMENT_STATUSES = ['visible', 'hidden', 'deleted'] as const
export type BlogCommentStatus = typeof BLOG_COMMENT_STATUSES[number]
export const BLOG_COMMENT_MAX_LENGTH = 4000
export const BLOG_COMMENTS_PAGE_MAX = 100

// ---- config -----------------------------------------------------------------

/** `Project.blog`. Off until a project turns it on; the posts are there either way. */
export type BlogConfig = {
  /** The hosted blog, the public API and the RSS feed answer. */
  enabled: boolean
  /** The blog's name; the project's name followed by "blog" when empty. */
  title: string
  description: string
  /** Signed-in readers may comment (a post can still close its own thread). */
  comments: boolean
  /** Readers may react to posts. */
  reactions: boolean
  /** Addresses told when a reader comments (never about the team's own comments). */
  commentNotify: string[]
  /** Where a post lives on the project's own site, for the feed and the newsletter: `{siteUrl}` and `{slug}` are filled in. Empty: the hosted page. */
  postUrl: string
  /** The marketing topic a newsletter goes to by default; empty: every subscriber. */
  newsletterTopic: string
  /** A sign-up form under each hosted post, into the project's contacts (the newsletter's audience). */
  subscribeForm: boolean
}

export const DEFAULT_BLOG_CONFIG: BlogConfig = {
  enabled: false,
  title: '',
  description: '',
  comments: true,
  reactions: true,
  commentNotify: [],
  postUrl: '',
  newsletterTopic: '',
  subscribeForm: false
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOPIC = /^[a-z0-9][a-z0-9-]{0,39}$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeBlogConfig(value: unknown): BlogConfig {
  return validateBlogConfig(value, DEFAULT_BLOG_CONFIG).config
}

/** Validate a (partial) config on top of `base`: only the keys sent change; bad values are reported, not applied. */
export function validateBlogConfig(value: unknown, base: BlogConfig = DEFAULT_BLOG_CONFIG): { config: BlogConfig, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('blog must be an object')
  const raw = record(value)
  const config: BlogConfig = { ...base, commentNotify: [...base.commentNotify] }

  for (const key of ['enabled', 'comments', 'reactions', 'subscribeForm'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') errors.push(`${key} must be true or false`)
    else config[key] = raw[key] as boolean
  }
  for (const [key, max] of [['title', 120], ['description', 300]] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string' || (raw[key] as string).trim().length > max) errors.push(`${key} is up to ${max} characters`)
    else config[key] = (raw[key] as string).trim()
  }
  if (raw.commentNotify !== undefined) {
    const list = typeof raw.commentNotify === 'string' ? raw.commentNotify.split(/[\s,;]+/) : Array.isArray(raw.commentNotify) ? raw.commentNotify : null
    const emails = (list || []).map(e => String(e).trim().toLowerCase()).filter(Boolean)
    if (!list || emails.length > 10 || emails.some(e => !EMAIL.test(e))) errors.push('commentNotify is up to 10 email addresses')
    else config.commentNotify = [...new Set(emails)]
  }
  if (raw.postUrl !== undefined) {
    const url = typeof raw.postUrl === 'string' ? raw.postUrl.trim() : null
    // A template, not a URL yet: `{siteUrl}` stands in for the scheme and host.
    if (url === null || url.length > 300 || (url && !url.includes('{slug}')) || (url && !url.startsWith('{siteUrl}') && !safeHttpUrl(url.replace('{slug}', 'x')))) errors.push('postUrl is an http(s) address (or one starting with {siteUrl}) containing {slug}')
    else config.postUrl = url
  }
  if (raw.newsletterTopic !== undefined) {
    const topic = typeof raw.newsletterTopic === 'string' ? raw.newsletterTopic.trim().toLowerCase() : null
    if (topic === null || (topic && !TOPIC.test(topic))) errors.push('newsletterTopic is a topic key (lowercase letters, digits and hyphens) or empty')
    else config.newsletterTopic = topic
  }
  return { config, errors }
}

/** The blog's name as readers see it. */
export function blogTitle(config: Pick<BlogConfig, 'title'>, projectName: string): string {
  return config.title || `${projectName || 'Our'} blog`
}

/** A post's address on the project's own site, or '' when the hosted page is its home. */
export function fillBlogPostUrl(template: string, siteUrl: string, slug: string): string {
  if (!template) return ''
  const url = template.replace('{siteUrl}', String(siteUrl || '').replace(/\/+$/, '')).replace('{slug}', encodeURIComponent(slug))
  return safeHttpUrl(url) ? url : ''
}

// ---- posts ------------------------------------------------------------------

/**
 * Title → URL key. NFD-normalises so accented letters keep their base letter
 * ("Cómo" → "como") rather than vanishing. The Swift port (BlogSlug.swift) must
 * give the same answer for the same title.
 */
export function blogSlugify(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BLOG_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
}

/** Whole minutes to read some text, never less than one. */
export function blogReadingMinutes(text: string): number {
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / BLOG_WORDS_PER_MINUTE))
}

/** Whether a post is public at `now`: published, and its date reached. */
export function isBlogPostLive(post: { status: BlogPostStatus, publishedAt: string | null }, now = Date.now()): boolean {
  return post.status === 'published' && !!post.publishedAt && new Date(post.publishedAt).getTime() <= now
}

/** The team's view of a post. */
export type BlogPost = {
  id: string
  projectId: string
  title: string
  slug: string
  /** The lead-in shown on the list, in the feed and as the page's description; written, or taken from the body. */
  excerpt: string
  /** Whether `excerpt` was written (true) or taken from the body (false). */
  excerptWritten: boolean
  /** Markdown, as the editor saves it. */
  body: string
  /** Sanitised HTML, rendered once on write. */
  bodyHtml: string
  coverImageUrl: string
  tags: string[]
  status: BlogPostStatus
  /** The date shown and the moment a published post goes public; set on first publish. */
  publishedAt: string | null
  /** Whether it is public right now. */
  live: boolean
  authorName: string
  readingMinutes: number
  /** Readers may comment on this post (the blog's `comments` must be on too). */
  commentsOpen: boolean
  commentCount: number
  reactions: BlogReactionSummary[]
  /** The newsletter campaign this post went out as, if it did. */
  newsletter: { campaignId: string, status: string } | null
  /** Where readers find it: the project's own site when `postUrl` is set, else the hosted page. */
  url: string
  createdAt: string
  updatedAt: string
}

/** What a reader gets. `bodyHtml` only on a single post, never on the list. */
export type PublicBlogPost = {
  id: string
  slug: string
  title: string
  excerpt: string
  bodyHtml?: string
  coverImageUrl: string
  tags: string[]
  publishedAt: string
  authorName: string
  readingMinutes: number
  commentsOpen: boolean
  commentCount: number
  reactions: BlogReactionSummary[]
  url: string
}

export type PublicBlog = {
  title: string
  description: string
  /** RSS 2.0 of the latest posts. */
  feedUrl: string
  /** Whether readers may react and comment at all. */
  reactions: boolean
  comments: boolean
  /** Whether the hosted page offers newsletter sign-up. */
  subscribeForm: boolean
  posts: PublicBlogPost[]
  total: number
  hasMore: boolean
}

export type BlogPostValues = {
  title?: string
  slug?: string
  excerpt?: string
  body?: string
  coverImageUrl?: string
  tags?: string[]
  status?: BlogPostStatus
  publishedAt?: Date | null
  commentsOpen?: boolean
}

/** Up to ten tags, trimmed, each once (whatever its case). */
export function readBlogTags(raw: unknown, errors: string[]): string[] | undefined {
  const list = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : null
  if (!list) { errors.push('tags must be a list of strings'); return undefined }
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of list) {
    const tag = String(item ?? '').trim().replace(/\s+/g, ' ')
    if (!tag || seen.has(tag.toLowerCase())) continue
    if (tag.length > BLOG_TAG_MAX_LENGTH) { errors.push(`A tag is up to ${BLOG_TAG_MAX_LENGTH} characters`); return undefined }
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }
  if (tags.length > BLOG_TAGS_MAX) { errors.push(`A post has at most ${BLOG_TAGS_MAX} tags`); return undefined }
  return tags
}

/** Read a create/update body. Only the keys sent are in `values`; a create gets a draft. */
export function readBlogPostInput(payload: unknown, options: { create: boolean }): { values: BlogPostValues, errors: string[] } {
  const raw = record(payload)
  const values: BlogPostValues = {}
  const errors: string[] = []
  const has = (key: string) => raw[key] !== undefined

  if (has('title') || options.create) {
    const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim() : ''
    if (!title) errors.push('A title is required')
    else if (title.length > BLOG_TITLE_MAX_LENGTH) errors.push(`The title is up to ${BLOG_TITLE_MAX_LENGTH} characters`)
    else values.title = title
  }
  if (has('slug')) {
    const slug = typeof raw.slug === 'string' ? blogSlugify(raw.slug) : null
    if (slug === null) errors.push('slug must be a string')
    else if (slug) values.slug = slug
  }
  if (has('excerpt')) {
    const excerpt = raw.excerpt === null ? '' : typeof raw.excerpt === 'string' ? raw.excerpt.replace(/\s+/g, ' ').trim() : null
    if (excerpt === null || excerpt.length > BLOG_EXCERPT_MAX_LENGTH) errors.push(`excerpt is up to ${BLOG_EXCERPT_MAX_LENGTH} characters`)
    else values.excerpt = excerpt
  }
  if (has('body')) {
    const body = raw.body === null ? '' : typeof raw.body === 'string' ? raw.body : null
    if (body === null || body.length > BLOG_BODY_MAX_LENGTH) errors.push(`body is Markdown of up to ${BLOG_BODY_MAX_LENGTH} characters`)
    else values.body = body
  }
  if (has('coverImageUrl')) {
    const url = raw.coverImageUrl === null ? '' : safeHttpUrl(raw.coverImageUrl)
    if (raw.coverImageUrl && !url) errors.push('coverImageUrl must be an http(s) URL')
    else values.coverImageUrl = url
  }
  if (has('tags')) {
    const tags = readBlogTags(raw.tags, errors)
    if (tags) values.tags = tags
  } else if (options.create) values.tags = []
  if (has('status')) {
    if ((BLOG_POST_STATUSES as readonly string[]).includes(String(raw.status))) values.status = raw.status as BlogPostStatus
    else errors.push(`status must be one of ${BLOG_POST_STATUSES.join(', ')}`)
  } else if (options.create) values.status = 'draft'
  if (has('publishedAt')) {
    const date = readDate(raw.publishedAt, 'publishedAt', errors)
    if (date !== undefined) values.publishedAt = date
  }
  if (has('commentsOpen')) {
    if (typeof raw.commentsOpen !== 'boolean') errors.push('commentsOpen must be true or false')
    else values.commentsOpen = raw.commentsOpen
  }
  return { values, errors }
}

// ---- reactions --------------------------------------------------------------

export function isBlogReaction(value: unknown): value is BlogReactionKey {
  return (BLOG_REACTIONS as readonly string[]).includes(String(value))
}

/** One reaction as stored on the post: `"key:actor"`, so two readers reacting at once never overwrite each other. */
export function blogReactionEntry(key: BlogReactionKey, actorId: string): string {
  return `${key}:${actorId}`
}

/** Counts per reaction, in the fixed order, and whether `actorId` left each one. */
export function summarizeBlogReactions(entries: unknown, actorId?: string): BlogReactionSummary[] {
  const counts = new Map<BlogReactionKey, number>()
  const mine = new Set<BlogReactionKey>()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = String(entry)
    const at = text.indexOf(':')
    const key = text.slice(0, at)
    if (at < 1 || !isBlogReaction(key)) continue
    counts.set(key, (counts.get(key) || 0) + 1)
    if (actorId && text.slice(at + 1) === actorId) mine.add(key)
  }
  return BLOG_REACTIONS.filter(key => counts.has(key)).map(key => ({ key, count: counts.get(key)!, ...(actorId ? { reacted: mine.has(key) } : {}) }))
}

// ---- comments ---------------------------------------------------------------

/** A reader's (or the team's) comment on a published post. */
export type BlogComment = {
  id: string
  postId: string
  /** The top-level comment this one answers; null for a top-level comment. Replies are one level deep. */
  parentId: string | null
  /** The author's Markdown, verbatim. */
  body: string
  bodyHtml: string
  status: BlogCommentStatus
  authorId: string
  authorName: string
  authorAvatar: string | null
  /** Written by the team (an operator, or the host's admin). */
  authorIsStaff: boolean
  createdAt: string
  editedAt: string | null
  viewerIsAuthor: boolean
}

export type BlogCommentPage = { comments: BlogComment[], total: number, hasMore: boolean }

/** A comment in the team's moderation list: which post it is on, too. */
export type BlogCommentWithPost = BlogComment & { postTitle: string, postSlug: string }

export function readBlogCommentInput(payload: unknown): { body?: string, status?: BlogCommentStatus, parentId?: string, errors: string[] } {
  const raw = record(payload)
  const errors: string[] = []
  const out: { body?: string, status?: BlogCommentStatus, parentId?: string } = {}
  if (raw.body !== undefined) {
    if (typeof raw.body !== 'string') errors.push('body must be a string')
    else out.body = raw.body
  }
  if (raw.status !== undefined) {
    if ((BLOG_COMMENT_STATUSES as readonly string[]).includes(String(raw.status))) out.status = raw.status as BlogCommentStatus
    else errors.push(`status must be one of ${BLOG_COMMENT_STATUSES.join(', ')}`)
  }
  if (raw.parentId !== undefined && raw.parentId !== null && raw.parentId !== '') {
    if (typeof raw.parentId !== 'string' || raw.parentId.length > 40) errors.push('parentId must be a comment id')
    else out.parentId = raw.parentId
  }
  return { ...out, errors }
}

/** Top-level comments in order, each followed by its replies: how a thread reads. */
export function threadBlogComments<T extends { id: string, parentId: string | null }>(comments: T[]): (T & { depth: 0 | 1 })[] {
  const ids = new Set(comments.map(c => c.id))
  // A reply whose parent is gone (deleted, or on another page) reads as top-level.
  const top = comments.filter(c => !c.parentId || !ids.has(c.parentId))
  return top.flatMap(c => [{ ...c, depth: 0 as const }, ...comments.filter(r => r.parentId === c.id && r !== c).map(r => ({ ...r, depth: 1 as const }))])
}
