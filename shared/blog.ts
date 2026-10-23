// The blog: long-form posts a project publishes on its own hosted page, in an
// RSS feed and, on a plan with campaigns, as a newsletter to its subscribers.
// Readers react to posts and comment on them. Shared by the API, the panel and
// the embed; the constants the native app needs are ported to Swift
// (tests/blogNativeParity.test.ts keeps them equal).

import { readDate } from './feedback'
import { DEFAULT_STYLE_CHOICE, validateStyleChoice, type ResolvedStyle, type StyleChoice } from './projectStyle'
import { safeHttpUrl } from './support'

export const BLOG_TITLE_MAX_LENGTH = 200
export const BLOG_SLUG_MAX_LENGTH = 80
export const BLOG_EXCERPT_MAX_LENGTH = 300
/** Source characters: a long essay with room to spare, or a long post imported as HTML. */
export const BLOG_BODY_MAX_LENGTH = 200_000
/** What search engines and link previews show; Ghost's limits. */
export const BLOG_META_TITLE_MAX_LENGTH = 300
export const BLOG_META_DESCRIPTION_MAX_LENGTH = 500
export const BLOG_ALT_MAX_LENGTH = 300
/** A post's `data`: JSON of your own for a site that renders posts itself, as serialised text. */
export const BLOG_DATA_MAX_LENGTH = 200_000
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

/** A post is in the list, the feed and the newsletter; a page (About, Contact) stands on its own, linked from the navigation. */
export const BLOG_POST_TYPES = ['post', 'page'] as const
export type BlogPostType = typeof BLOG_POST_TYPES[number]

/** Who reads the body: everyone, or the blog's members (readers signed in with your app or their email). */
export const BLOG_VISIBILITIES = ['public', 'members'] as const
export type BlogVisibility = typeof BLOG_VISIBILITIES[number]

/** How the body is written: Markdown (what the editor saves) or HTML (a post imported from Ghost). */
export const BLOG_BODY_FORMATS = ['markdown', 'html'] as const
export type BlogBodyFormat = typeof BLOG_BODY_FORMATS[number]

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

// ---- design -----------------------------------------------------------------

/** How the hosted blog lays out its posts: one column, a grid of cards, or the newest featured post large above a grid. */
export const BLOG_LAYOUTS = ['list', 'grid', 'magazine'] as const
export type BlogLayout = typeof BLOG_LAYOUTS[number]
export const BLOG_FONTS = ['sans', 'serif'] as const
export type BlogFont = typeof BLOG_FONTS[number]
export const BLOG_COLOR_SCHEMES = ['auto', 'light', 'dark'] as const
export type BlogColorScheme = typeof BLOG_COLOR_SCHEMES[number]
export const BLOG_SOCIAL_NETWORKS = ['x', 'bluesky', 'mastodon', 'github', 'linkedin', 'instagram', 'youtube', 'website'] as const
export type BlogSocialNetwork = typeof BLOG_SOCIAL_NETWORKS[number]
export const BLOG_NAVIGATION_MAX = 8

/** A link in the hosted blog's header: an http(s) address, or a path on the blog (`/about` is the page with slug `about`, `/` the blog itself). */
export type BlogNavLink = { label: string, url: string }

/** The hosted blog's look (Ghost's Design settings). The embed takes your page's look instead, and the layout. */
export type BlogDesign = {
  layout: BlogLayout
  font: BlogFont
  colorScheme: BlogColorScheme
  /** '#rrggbb', or '' for the project's accent. */
  accent: string
  /** '' falls back to the project's brand logo. */
  logoUrl: string
  /** A wide image across the top of the blog's front page. */
  coverImageUrl: string
  navigation: BlogNavLink[]
  social: Partial<Record<BlogSocialNetwork, string>>
  footer: string
}

export const DEFAULT_BLOG_DESIGN: BlogDesign = { layout: 'list', font: 'sans', colorScheme: 'auto', accent: '', logoUrl: '', coverImageUrl: '', navigation: [], social: {}, footer: '' }

/** A navigation target as stored: an http(s) URL, or a blog path (`/`, `/about`). Null when it is neither. */
export function readBlogNavUrl(value: unknown): string | null {
  const url = typeof value === 'string' ? value.trim() : ''
  if (/^\/[a-z0-9/-]{0,120}$/i.test(url) && !url.includes('//')) return url.toLowerCase()
  return safeHttpUrl(url) || null
}

function validateDesign(value: unknown, base: BlogDesign, errors: string[]): BlogDesign {
  const raw = record(value)
  const design: BlogDesign = { ...base, navigation: [...base.navigation], social: { ...base.social } }
  const choose = <T extends string>(key: 'layout' | 'font' | 'colorScheme', options: readonly T[]) => {
    if (raw[key] === undefined) return
    if (options.includes(raw[key] as T)) (design as unknown as Record<string, unknown>)[key] = raw[key]
    else errors.push(`design.${key} is one of ${options.join(', ')}`)
  }
  choose('layout', BLOG_LAYOUTS)
  choose('font', BLOG_FONTS)
  choose('colorScheme', BLOG_COLOR_SCHEMES)
  if (raw.accent !== undefined) {
    const accent = typeof raw.accent === 'string' ? raw.accent.trim() : null
    if (accent === null || (accent && !/^#[0-9a-f]{6}$/i.test(accent))) errors.push('design.accent must be a #rrggbb colour or empty')
    else design.accent = accent
  }
  for (const key of ['logoUrl', 'coverImageUrl'] as const) {
    if (raw[key] === undefined) continue
    const url = raw[key] === null ? '' : safeHttpUrl(raw[key])
    if (raw[key] && !url) errors.push(`design.${key} must be an http(s) URL`)
    else design[key] = url
  }
  if (raw.footer !== undefined) {
    if (typeof raw.footer !== 'string' || raw.footer.trim().length > 300) errors.push('design.footer is up to 300 characters')
    else design.footer = raw.footer.trim()
  }
  if (raw.navigation !== undefined) {
    const list = Array.isArray(raw.navigation) ? raw.navigation : null
    const links = (list || []).map(item => record(item)).map(item => ({ label: typeof item.label === 'string' ? item.label.trim() : '', url: readBlogNavUrl(item.url) }))
    if (!list || links.length > BLOG_NAVIGATION_MAX || links.some(link => !link.label || link.label.length > 40 || !link.url)) errors.push(`design.navigation is up to ${BLOG_NAVIGATION_MAX} links, each a label (up to 40 characters) and an http(s) address or a path such as /about`)
    else design.navigation = links.map(link => ({ label: link.label, url: link.url! }))
  }
  if (raw.social !== undefined) {
    const social = record(raw.social)
    for (const [key, url] of Object.entries(social)) {
      if (!(BLOG_SOCIAL_NETWORKS as readonly string[]).includes(key)) { errors.push(`design.social.${key} is not a network (${BLOG_SOCIAL_NETWORKS.join(', ')})`); continue }
      const clean = url === null || url === '' ? '' : safeHttpUrl(url)
      if (url && !clean) errors.push(`design.social.${key} must be an http(s) URL`)
      else if (clean) design.social[key as BlogSocialNetwork] = clean
      else delete design.social[key as BlogSocialNetwork]
    }
  }
  return design
}

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
  /** How the hosted blog looks. */
  design: BlogDesign
  /** How the hosted blog takes its style: the project's, or its own over it. `design` stays the blog's own layer over both. */
  style: StyleChoice
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
  subscribeForm: false,
  design: DEFAULT_BLOG_DESIGN,
  style: DEFAULT_STYLE_CHOICE
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
  const config: BlogConfig = { ...base, commentNotify: [...base.commentNotify], design: base.design || DEFAULT_BLOG_DESIGN }

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
  // Partial too: a layout change does not resend the navigation.
  config.design = validateDesign(raw.design, config.design, errors)
  if (raw.style !== undefined) {
    const style = validateStyleChoice(raw.style, base.style ?? DEFAULT_STYLE_CHOICE)
    errors.push(...style.errors)
    config.style = style.choice
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
 * ("Cómo" → "como") rather than vanishing. The Swift port (BlogSlug in BlogModels.swift) must
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

/** What search engines and link previews show, each falling back to the post's own when empty. */
export type BlogSeo = {
  metaTitle: string
  metaDescription: string
  /** The image link previews show; the cover when empty. */
  ogImageUrl: string
  /** Where the post first appeared, when that is elsewhere (an import, a guest post). */
  canonicalUrl: string
}

/** The team's view of a post. */
export type BlogPost = BlogSeo & {
  id: string
  projectId: string
  type: BlogPostType
  title: string
  slug: string
  /** The lead-in shown on the list, in the feed and as the page's description; written, or taken from the body. */
  excerpt: string
  /** Whether `excerpt` was written (true) or taken from the body (false). */
  excerptWritten: boolean
  /** As the editor saves it: Markdown, or HTML for a post imported as HTML. */
  body: string
  bodyFormat: BlogBodyFormat
  /** Sanitised HTML, rendered once on write. */
  bodyHtml: string
  /** JSON of your own (an object), for a site that renders its posts from the API; `null` when none. */
  data: Record<string, unknown> | null
  coverImageUrl: string
  coverImageAlt: string
  tags: string[]
  /** Shown first: large on the magazine layout, marked on the others. */
  featured: boolean
  visibility: BlogVisibility
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

/** What a reader gets. `bodyHtml` only on a single post, never on the list, and not when `locked`. */
export type PublicBlogPost = BlogSeo & {
  id: string
  type: BlogPostType
  slug: string
  title: string
  excerpt: string
  bodyHtml?: string
  /** Your own JSON, on one post only (like `bodyHtml`), not in the list, and not when `locked`. */
  data?: Record<string, unknown> | null
  coverImageUrl: string
  coverImageAlt: string
  tags: string[]
  featured: boolean
  visibility: BlogVisibility
  /** A members-only post this viewer may not read yet: sign in (an identity token, or an email-only session) for the body. */
  locked: boolean
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
  /** The hosted blog's layout, for an embed that wants to match it. */
  layout: BlogLayout
  /** What the blog wears (the project's style with the blog's own over it), every gap filled: light and dark palettes, radius, shadow, font. */
  style: ResolvedStyle
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

export type BlogPostValues = Partial<BlogSeo> & {
  type?: BlogPostType
  title?: string
  slug?: string
  excerpt?: string
  body?: string
  bodyFormat?: BlogBodyFormat
  data?: Record<string, unknown> | null
  coverImageUrl?: string
  coverImageAlt?: string
  tags?: string[]
  featured?: boolean
  visibility?: BlogVisibility
  status?: BlogPostStatus
  publishedAt?: Date | null
  commentsOpen?: boolean
}

/**
 * A post's `data` as stored: JSON text, because the database refuses object keys with a dot or a leading `$`,
 * which JSON of your own (`"light.exposure"`) is full of. Kept in the field `dataJson`; reads the text, or an object saved before it was text (the field `data`).
 */
export function readBlogData(stored: unknown): Record<string, unknown> | null {
  let value = stored
  if (typeof stored === 'string') {
    try { value = JSON.parse(stored) } catch { return null }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
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
    if (body === null || body.length > BLOG_BODY_MAX_LENGTH) errors.push(`body is up to ${BLOG_BODY_MAX_LENGTH} characters`)
    else values.body = body
  }
  if (has('data')) {
    if (raw.data === null) values.data = null
    else if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) errors.push('data must be a JSON object, or null to clear it')
    else if (JSON.stringify(raw.data).length > BLOG_DATA_MAX_LENGTH) errors.push(`data is up to ${BLOG_DATA_MAX_LENGTH} characters as JSON`)
    else values.data = raw.data as Record<string, unknown>
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
  for (const key of ['commentsOpen', 'featured'] as const) {
    if (!has(key)) continue
    if (typeof raw[key] !== 'boolean') errors.push(`${key} must be true or false`)
    else values[key] = raw[key] as boolean
  }
  const choose = <T extends string>(key: 'type' | 'visibility' | 'bodyFormat', allowed: readonly T[], fallback: T) => {
    if (has(key)) {
      if (allowed.includes(raw[key] as T)) values[key] = raw[key] as never
      else errors.push(`${key} must be one of ${allowed.join(', ')}`)
    } else if (options.create) values[key] = fallback as never
  }
  choose('type', BLOG_POST_TYPES, 'post')
  choose('visibility', BLOG_VISIBILITIES, 'public')
  choose('bodyFormat', BLOG_BODY_FORMATS, 'markdown')
  for (const [key, max] of [['metaTitle', BLOG_META_TITLE_MAX_LENGTH], ['metaDescription', BLOG_META_DESCRIPTION_MAX_LENGTH], ['coverImageAlt', BLOG_ALT_MAX_LENGTH]] as const) {
    if (!has(key)) continue
    const text = raw[key] === null ? '' : typeof raw[key] === 'string' ? (raw[key] as string).replace(/\s+/g, ' ').trim() : null
    if (text === null || text.length > max) errors.push(`${key} is up to ${max} characters`)
    else values[key] = text
  }
  for (const key of ['ogImageUrl', 'canonicalUrl'] as const) {
    if (!has(key)) continue
    const url = raw[key] === null ? '' : safeHttpUrl(raw[key])
    if (raw[key] && !url) errors.push(`${key} must be an http(s) URL`)
    else values[key] = url
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
