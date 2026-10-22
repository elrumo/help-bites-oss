import { createError, getHeader, getQuery, type H3Event } from 'h3'
import {
  BLOG_PAGE_MAX,
  BLOG_REACTIONS,
  BLOG_RESERVED_SLUGS,
  BLOG_SLUG_MAX_LENGTH,
  blogReactionEntry,
  blogSlugify,
  blogTitle,
  fillBlogPostUrl,
  isBlogReaction,
  normalizeBlogConfig,
  readBlogPostInput,
  summarizeBlogReactions,
  type BlogBodyFormat,
  type BlogConfig,
  type BlogPost,
  type BlogPostStatus,
  type BlogPostType,
  type BlogVisibility,
  type PublicBlog,
  type PublicBlogPost
} from '#shared/blog'
import { EMPTY_CAMPAIGN_STATS } from '#shared/marketing'
import { literalBraceText } from './blogRender'
import { anonymousWriteGate } from './endUserSessions'
import type { IdentityClaims } from './jwt'
import { emitDomainEvent } from './domainEvents'

// The blog: posts the team writes in the panel (or through the API) and
// readers find on the hosted page, through the embed, in the RSS feed and, as
// a campaign, in their inbox. Like the changelog, every row is master-only and
// the rules live here, so the three kinds of caller see one blog:
//
//   anonymous  `?pk=` (or X-Project-Key) — reads published posts
//   user       a host-signed identity token or an email-only `eu_` session —
//              reacts and comments; with `role: "admin"` the host's staff also moderate
//   agent      an operator session or admin key — writes posts, moderates
//
// Comments live in blogComments.ts.

export type BlogActor =
  | { kind: 'anonymous' }
  | { kind: 'user', externalId: string, name: string, isAdmin: boolean, claims: IdentityClaims }
  | { kind: 'agent', agent: ParseObject }

export type BlogContext = { project: ParseObject, config: BlogConfig, actor: BlogActor }

function badRequest(errors: string[]): never {
  throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

export function getBlogConfig(project: ParseObject): BlogConfig {
  return normalizeBlogConfig(project.get('blog'))
}

/** Operators and the host's admins: they see drafts and moderate. */
export function isBlogStaff(actor: BlogActor): boolean {
  return actor.kind === 'agent' || (actor.kind === 'user' && actor.isAdmin)
}

/**
 * Who may read a members-only post: the team, a user your app signed in, or a
 * reader who confirmed their address with the emailed code. An email-only
 * reader who has not is not a member yet.
 */
export function isBlogMember(actor: BlogActor): boolean {
  return actor.kind === 'agent' || (actor.kind === 'user' && (!actor.claims.anon || actor.claims.emailVerified === true))
}

/** Who a reaction or comment belongs to: the host's user id, or the operator. */
export function blogActorId(actor: BlogActor): string {
  if (actor.kind === 'user') return actor.externalId
  if (actor.kind === 'agent') return `agent:${actor.agent.id}`
  return ''
}

/**
 * The project and caller of a blog request. `projectId` pins the project when
 * the route already knows it (a comment's own). The project secret is refused:
 * reactions and comments have authors, and posts are written by operators.
 */
export async function resolveBlogContext(event: H3Event, options: { projectId?: string } = {}): Promise<BlogContext> {
  const token = optionalBearer(event)
  const query = getQuery(event)

  if (token.startsWith('sk_')) throw createError({ statusCode: 401, statusMessage: 'Use an operator session, an admin key or an identity token, not the project secret' })

  if (token.startsWith('r:') || token.startsWith('ak_')) {
    const member = await requireMember(event, { can: 'content' })
    const id = options.projectId || String(query.project || '')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
    const project = await requireProject(member, id)
    return { project, config: getBlogConfig(project), actor: { kind: 'agent', agent: member.agent } }
  }

  if (token) {
    const { project, claims } = await verifyEndUserToken(event, token)
    if (options.projectId && project.id !== options.projectId) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    // Email-only readers get a few free writes, then must verify their address.
    if (event.method !== 'GET' && event.method !== 'HEAD') await anonymousWriteGate(project, claims, 'comments')
    const actor: BlogActor = { kind: 'user', externalId: claims.sub, name: String(claims.name || '').trim().slice(0, 120), isAdmin: claims.role === 'admin', claims }
    const config = getBlogConfig(project)
    if (!config.enabled && !actor.isAdmin) throw createError({ statusCode: 404, statusMessage: 'No blog here' })
    return { project, config, actor }
  }

  const pk = String(query.pk || getHeader(event, 'x-project-key') || '').trim()
  if (!pk) throw createError({ statusCode: 401, statusMessage: 'Pass ?pk=<public key> or an identity token' })
  const project = await findProjectByPublicKey(pk)
  if (!project || (options.projectId && project.id !== options.projectId)) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  await rateLimit(`sb:rl:blogread:${clientIp(event) || 'ip'}`, LIMITS.blogReadsPerIp.limit, LIMITS.blogReadsPerIp.window)
  const config = getBlogConfig(project)
  if (!config.enabled) throw createError({ statusCode: 404, statusMessage: 'No blog here' })
  return { project, config, actor: { kind: 'anonymous' } }
}

/** The project an operator's admin route acts on: `?project=` or the body's `project`. */
export async function blogProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest(['Pass ?project=<projectId>'])
  return await requireProject(ctx, named)
}

// ---- rows ------------------------------------------------------------------------

/** A post by object id, from any project: for scoped.blogPost and workers, never an admin route directly. */
export async function getBlogPost(id: string): Promise<ParseObject> {
  const row = /^[A-Za-z0-9]{1,40}$/.test(id) ? await new (useParse()).Query('BlogPost').get(id, MASTER).catch(() => undefined) : undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  return row
}

/** A post in a project by its slug or object id. */
export async function findBlogPost(project: ParseObject, ref: string): Promise<ParseObject | undefined> {
  const name = String(ref || '').trim()
  if (!name) return undefined
  const base = () => new (useParse()).Query('BlogPost').equalTo('project', project)
  return await base().equalTo('slug', name).first(MASTER)
    || (/^[A-Za-z0-9]{6,40}$/.test(name) ? await base().equalTo('objectId', name).first(MASTER) : undefined)
}

function statusOf(row: ParseObject): BlogPostStatus {
  return row.get('status') === 'published' ? 'published' : 'draft'
}

/** Rows from before pages existed are posts; before visibility, public. */
export function blogPostTypeOf(row: ParseObject): BlogPostType {
  return row.get('type') === 'page' ? 'page' : 'post'
}

function visibilityOf(row: ParseObject): BlogVisibility {
  return row.get('visibility') === 'members' ? 'members' : 'public'
}

function formatOf(row: ParseObject): BlogBodyFormat {
  return row.get('bodyFormat') === 'html' ? 'html' : 'markdown'
}

/** Published and its date reached. */
export function isBlogPostRowLive(row: ParseObject, now = Date.now()): boolean {
  const at = row.get('publishedAt') as Date | undefined
  return statusOf(row) === 'published' && !!at && at.getTime() <= now
}

/** The post a reader asks for: live (the team also sees a draft). */
export async function readableBlogPost(ctx: BlogContext, ref: string): Promise<ParseObject> {
  const row = await findBlogPost(ctx.project, ref)
  if (!row || (!isBlogPostRowLive(row) && !isBlogStaff(ctx.actor))) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  return row
}

// ---- links -----------------------------------------------------------------------

function appBase(): string {
  return String(process.env.APP_URL || '').trim().replace(/\/+$/, '')
}

/** The hosted blog, or one post on it. */
export function hostedBlogUrl(project: ParseObject, slug = ''): string {
  const pk = encodeURIComponent(String(project.get('publicKey') || ''))
  return `${appBase()}/blog/${pk}${slug ? `/${encodeURIComponent(slug)}` : ''}`
}

export function blogFeedUrl(project: ParseObject): string {
  return `${appBase()}/v1/projects/${encodeURIComponent(String(project.get('publicKey') || ''))}/blog.rss`
}

/** Where readers find a post: the project's own site when `postUrl` is set, else the hosted page. */
export function blogPostUrl(project: ParseObject, row: ParseObject): string {
  const slug = String(row.get('slug') || row.id || '')
  return fillBlogPostUrl(getBlogConfig(project).postUrl, String(project.get('siteUrl') || ''), slug) || hostedBlogUrl(project, slug)
}

// ---- serialize -------------------------------------------------------------------

function seoOf(row: ParseObject) {
  return {
    metaTitle: String(row.get('metaTitle') || ''),
    metaDescription: String(row.get('metaDescription') || ''),
    ogImageUrl: String(row.get('ogImageUrl') || ''),
    canonicalUrl: String(row.get('canonicalUrl') || '')
  }
}

export function serializeBlogPost(project: ParseObject, row: ParseObject): BlogPost {
  const campaign = row.get('newsletterCampaign') as ParseObject | undefined
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    type: blogPostTypeOf(row),
    title: String(row.get('title') || ''),
    slug: String(row.get('slug') || ''),
    excerpt: String(row.get('excerpt') || ''),
    excerptWritten: row.get('excerptWritten') === true,
    body: String(row.get('body') || ''),
    bodyFormat: formatOf(row),
    bodyHtml: String(row.get('bodyHtml') || ''),
    coverImageUrl: String(row.get('coverImageUrl') || ''),
    coverImageAlt: String(row.get('coverImageAlt') || ''),
    tags: stringList(row.get('tags')),
    featured: row.get('featured') === true,
    visibility: visibilityOf(row),
    ...seoOf(row),
    status: statusOf(row),
    publishedAt: iso(row.get('publishedAt')),
    live: isBlogPostRowLive(row),
    authorName: String(row.get('authorName') || ''),
    readingMinutes: Number(row.get('readingMinutes') || 1),
    commentsOpen: row.get('commentsOpen') !== false,
    commentCount: Number(row.get('commentCount') || 0),
    reactions: summarizeBlogReactions(row.get('reactions')),
    newsletter: campaign?.id ? { campaignId: campaign.id, status: String(campaign.get('status') || 'draft') } : null,
    url: blogPostUrl(project, row),
    createdAt: iso(row.createdAt) || '',
    updatedAt: iso(row.updatedAt) || ''
  }
}

/**
 * A post as a reader gets it. `body` adds the HTML (a single post); `member`
 * says whether the viewer may read a members-only one, which otherwise comes
 * `locked`, without its body. Pages take no comments or reactions.
 */
export function serializePublicBlogPost(project: ParseObject, config: BlogConfig, row: ParseObject, viewerId: string, options: { body?: boolean, member?: boolean } = {}): PublicBlogPost {
  const visibility = visibilityOf(row)
  const locked = visibility === 'members' && !options.member
  const post = blogPostTypeOf(row) === 'post'
  return {
    id: row.id || '',
    type: blogPostTypeOf(row),
    slug: String(row.get('slug') || ''),
    title: String(row.get('title') || ''),
    excerpt: String(row.get('excerpt') || ''),
    ...(options.body && !locked ? { bodyHtml: String(row.get('bodyHtml') || '') } : {}),
    coverImageUrl: String(row.get('coverImageUrl') || ''),
    coverImageAlt: String(row.get('coverImageAlt') || ''),
    tags: stringList(row.get('tags')),
    featured: row.get('featured') === true,
    visibility,
    locked,
    ...seoOf(row),
    publishedAt: iso(row.get('publishedAt')) || '',
    authorName: String(row.get('authorName') || ''),
    readingMinutes: Number(row.get('readingMinutes') || 1),
    commentsOpen: post && config.comments && row.get('commentsOpen') !== false,
    commentCount: post && config.comments ? Number(row.get('commentCount') || 0) : 0,
    reactions: post && config.reactions ? summarizeBlogReactions(row.get('reactions'), viewerId || undefined) : [],
    url: blogPostUrl(project, row)
  }
}

// ---- lists -----------------------------------------------------------------------

export type BlogPostFilter = { status?: BlogPostStatus, tag?: string, type?: BlogPostType }

/** Every post of a project for the team: drafts first, then the newest published (up to 1,000). */
export async function listBlogPosts(project: ParseObject, filter: BlogPostFilter = {}): Promise<ParseObject[]> {
  const query = new (useParse()).Query('BlogPost').equalTo('project', project).include('newsletterCampaign').exclude('body').exclude('bodyHtml')
  if (filter.status) query.equalTo('status', filter.status)
  if (filter.tag) query.equalTo('tagKeys', filter.tag.toLowerCase())
  if (filter.type === 'page') query.equalTo('type', 'page')
  else if (filter.type === 'post') query.notEqualTo('type', 'page')
  const rows = await query.descending('updatedAt').limit(1000).find(MASTER)
  const when = (row: ParseObject) => statusOf(row) === 'draft' ? Infinity : ((row.get('publishedAt') as Date | undefined)?.getTime() || 0)
  return rows.sort((a, b) => when(b) - when(a))
}

export type BlogPage = { limit: number, skip: number, tag?: string, type?: BlogPostType, featured?: boolean, q?: string }

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The live posts (or pages), newest first, a page at a time; `q` finds words in the title, the excerpt or a tag. */
export async function listPublicBlog(ctx: BlogContext, page: BlogPage): Promise<PublicBlog> {
  const Parse = useParse()
  const build = () => {
    const query = new Parse.Query('BlogPost').equalTo('project', ctx.project).equalTo('status', 'published').lessThanOrEqualTo('publishedAt', new Date())
    if (page.type === 'page') query.equalTo('type', 'page')
    else query.notEqualTo('type', 'page')
    if (page.tag) query.equalTo('tagKeys', page.tag.toLowerCase())
    if (page.featured) query.equalTo('featured', true)
    return query
  }
  const words = page.q ? escapeRegExp(page.q) : ''
  const find = () => words
    ? Parse.Query.or(build().matches('title', words, 'i'), build().matches('excerpt', words, 'i'), build().equalTo('tagKeys', page.q!.toLowerCase()))
    : build()
  const [rows, total] = await Promise.all([
    find().exclude('body').exclude('bodyHtml').descending('publishedAt').skip(page.skip).limit(page.limit).find(MASTER),
    find().count(MASTER)
  ])
  const viewer = blogActorId(ctx.actor)
  const member = isBlogMember(ctx.actor)
  return {
    title: blogTitle(ctx.config, String(ctx.project.get('name') || '')),
    description: ctx.config.description,
    layout: ctx.config.design.layout,
    feedUrl: blogFeedUrl(ctx.project),
    reactions: ctx.config.reactions,
    comments: ctx.config.comments,
    subscribeForm: ctx.config.subscribeForm,
    posts: rows.map(row => serializePublicBlogPost(ctx.project, ctx.config, row, viewer, { member })),
    total,
    hasMore: page.skip + rows.length < total
  }
}

function livePostsQuery(project: ParseObject) {
  return new (useParse()).Query('BlogPost').equalTo('project', project).equalTo('status', 'published').lessThanOrEqualTo('publishedAt', new Date()).notEqualTo('type', 'page').exclude('body').exclude('bodyHtml')
}

/** The live posts either side of this one by date, for "Newer" and "Older" under it. */
export async function adjacentBlogPosts(project: ParseObject, row: ParseObject): Promise<{ newer?: ParseObject, older?: ParseObject }> {
  const at = row.get('publishedAt') as Date | undefined
  if (!at || blogPostTypeOf(row) === 'page') return {}
  const [newer, older] = await Promise.all([
    livePostsQuery(project).greaterThan('publishedAt', at).ascending('publishedAt').first(MASTER),
    livePostsQuery(project).lessThan('publishedAt', at).descending('publishedAt').first(MASTER)
  ])
  return { newer, older }
}

/** Up to `limit` other live posts sharing a tag with this one, newest first, topped up with the newest posts. */
export async function relatedBlogPosts(project: ParseObject, row: ParseObject, limit = 3): Promise<ParseObject[]> {
  if (blogPostTypeOf(row) === 'page') return []
  const keys = stringList(row.get('tagKeys'))
  const tagged = keys.length ? await livePostsQuery(project).containedIn('tagKeys', keys).notEqualTo('objectId', row.id).descending('publishedAt').limit(limit).find(MASTER) : []
  if (tagged.length >= limit) return tagged
  const seen = new Set([row.id, ...tagged.map(post => post.id)])
  const latest = await livePostsQuery(project).descending('publishedAt').limit(limit + seen.size).find(MASTER)
  return [...tagged, ...latest.filter(post => !seen.has(post.id))].slice(0, limit)
}

/** Every live post and page, for the sitemap (up to 5,000). */
export async function sitemapBlogPosts(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('BlogPost').equalTo('project', project).equalTo('status', 'published').lessThanOrEqualTo('publishedAt', new Date())
    .select('slug', 'type', 'canonicalUrl', 'publishedAt').descending('publishedAt').limit(5000).find(MASTER)
}

export function readBlogPage(query: Record<string, unknown>): BlogPage {
  const whole = (raw: unknown, fallback: number, min: number, max: number) => {
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) badRequest([`limit and skip must be whole numbers (limit up to ${BLOG_PAGE_MAX})`])
    return n
  }
  const text = (raw: unknown, max: number) => typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\s+/g, ' ').slice(0, max) : undefined
  if (query.type !== undefined && query.type !== 'post' && query.type !== 'page') badRequest(['type is post or page'])
  return {
    limit: whole(query.limit, 20, 1, BLOG_PAGE_MAX),
    skip: whole(query.skip, 0, 0, 100_000),
    tag: text(query.tag, 40),
    type: query.type === 'page' ? 'page' : 'post',
    featured: query.featured === 'true' || query.featured === '1',
    q: text(query.q, 100)
  }
}

// ---- writes ----------------------------------------------------------------------

/**
 * The slug, or the slug with `-2`, `-3`… until no other post of the project
 * has it. Checked here rather than by an index: Parse's schema API cannot
 * declare a unique one, and two posts saved in the same instant is the only race.
 */
export async function uniqueBlogSlug(project: ParseObject, wanted: string, exceptId = ''): Promise<string> {
  const root = blogSlugify(wanted) || `post-${Date.now().toString(36)}`
  const taken = async (slug: string) => (BLOG_RESERVED_SLUGS as readonly string[]).includes(slug)
    || !!(await new (useParse()).Query('BlogPost').equalTo('project', project).equalTo('slug', slug).notEqualTo('objectId', exceptId || '-').first(MASTER))
  if (!(await taken(root))) return root
  for (let n = 2; n <= 50; n++) {
    const candidate = `${root.slice(0, BLOG_SLUG_MAX_LENGTH - String(n).length - 1)}-${n}`
    if (!(await taken(candidate))) return candidate
  }
  return `${root.slice(0, BLOG_SLUG_MAX_LENGTH - 8)}-${Date.now().toString(36)}`
}

async function applyBlogPostInput(project: ParseObject, row: ParseObject, payload: unknown, create: boolean): Promise<void> {
  const { values, errors } = readBlogPostInput(payload, { create })
  if (errors.length) badRequest(errors)
  if (values.title !== undefined) row.set('title', values.title)
  if (values.slug !== undefined || create) row.set('slug', await uniqueBlogSlug(project, values.slug || values.title || String(row.get('title') || ''), row.id))
  if (values.type !== undefined) row.set('type', values.type)
  if (values.bodyFormat !== undefined) row.set('bodyFormat', values.bodyFormat)
  if (values.body !== undefined || values.bodyFormat !== undefined) {
    const body = values.body ?? String(row.get('body') || '')
    row.set('body', body)
    row.set('bodyHtml', renderBlogBody(body, formatOf(row)))
    row.set('readingMinutes', blogBodyStats(body, formatOf(row)).readingMinutes)
  }
  if (values.excerpt !== undefined) row.set('excerptWritten', Boolean(values.excerpt))
  // A written lead-in stays as written; otherwise it follows the body.
  if (values.excerpt) row.set('excerpt', values.excerpt)
  else if (row.get('excerptWritten') !== true) row.set('excerpt', deriveBlogExcerpt(String(row.get('body') || ''), 200, formatOf(row)))
  for (const key of ['coverImageUrl', 'coverImageAlt', 'metaTitle', 'metaDescription', 'ogImageUrl', 'canonicalUrl', 'featured', 'visibility'] as const) {
    if (values[key] !== undefined) row.set(key, values[key])
  }
  if (values.tags !== undefined) {
    row.set('tags', values.tags)
    row.set('tagKeys', values.tags.map(tag => tag.toLowerCase()))
  }
  if (values.commentsOpen !== undefined) row.set('commentsOpen', values.commentsOpen)
  if (values.publishedAt !== undefined) {
    if (values.publishedAt) row.set('publishedAt', values.publishedAt)
    else row.unset('publishedAt')
  }
  if (values.status !== undefined) row.set('status', values.status)
  // Published without a date: dated now. Unpublishing keeps the date it had.
  if (statusOf(row) === 'published' && !row.get('publishedAt')) row.set('publishedAt', new Date())
}

// ---- events ----------------------------------------------------------------------

type BlogEvent = { type: string, data: Record<string, unknown> }

function blogWebhookPost(project: ParseObject, row: ParseObject) {
  return { id: row.id || '', slug: String(row.get('slug') || ''), title: String(row.get('title') || ''), visibility: visibilityOf(row), publishedAt: iso(row.get('publishedAt')), url: blogPostUrl(project, row) }
}

/**
 * The event a write means for the project's webhook, marking the row so it is
 * sent once: `blog.post.published` when a post went public (now, or when its
 * scheduled moment came: the worker), `blog.post.updated` when a public one
 * changed, `blog.post.unpublished` when it stopped being public. Pages are not announced.
 */
function blogAnnouncement(project: ParseObject, row: ParseObject, edited: boolean): BlogEvent | null {
  const live = blogPostTypeOf(row) === 'post' && isBlogPostRowLive(row)
  const announced = row.get('announced') === true
  if (live !== announced) row.set('announced', live)
  const type: string | null = live && !announced ? 'blog.post.published' : !live && announced ? 'blog.post.unpublished' : live && edited ? 'blog.post.updated' : null
  return type ? { type, data: { post: blogWebhookPost(project, row) } } : null
}

async function saveAndAnnounce(project: ParseObject, row: ParseObject, options: { edited: boolean, quiet?: boolean }): Promise<void> {
  const event = blogAnnouncement(project, row, options.edited)
  await row.save(null, MASTER)
  if (event && !options.quiet) await emitDomainEvent(project, event.type, event.data)
}

/** Scheduled posts whose moment came in the last day, announced by the worker (older ones are left alone: an import is not news). */
export async function announceDueBlogPosts(limit = 50): Promise<void> {
  const rows = await new (useParse()).Query('BlogPost')
    .equalTo('status', 'published')
    .lessThanOrEqualTo('publishedAt', new Date())
    .greaterThan('publishedAt', new Date(Date.now() - 24 * 3600_000))
    .notEqualTo('announced', true)
    .notEqualTo('type', 'page')
    .include('project')
    .limit(limit)
    .find(MASTER)
  for (const row of rows) {
    const project = row.get('project') as ParseObject | undefined
    if (project) await saveAndAnnounce(project, row, { edited: false })
  }
}

/** `quiet`: no webhook; `externalId`: where an imported post came from. */
export async function createBlogPost(project: ParseObject, agent: ParseObject | null, payload: unknown, options: { quiet?: boolean, externalId?: string } = {}): Promise<ParseObject> {
  const row = new (useParse().Object.extend('BlogPost'))() as ParseObject
  row.set('project', project)
  row.set('commentsOpen', true)
  row.set('commentCount', 0)
  row.set('reactions', [])
  row.set('body', '')
  row.set('bodyHtml', '')
  row.set('readingMinutes', 1)
  if (agent) {
    row.set('author', agent)
    row.set('authorName', String(agent.get('name') || agent.get('username') || ''))
  }
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (typeof raw.authorName === 'string' && raw.authorName.trim()) row.set('authorName', raw.authorName.trim().slice(0, 120))
  if (options.externalId) row.set('externalId', options.externalId)
  await applyBlogPostInput(project, row, payload, true)
  await saveAndAnnounce(project, row, { edited: false, quiet: options.quiet })
  return row
}

export async function updateBlogPost(project: ParseObject, row: ParseObject, payload: unknown, options: { quiet?: boolean } = {}): Promise<void> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (typeof raw.authorName === 'string') row.set('authorName', raw.authorName.trim().slice(0, 120))
  await applyBlogPostInput(project, row, payload, false)
  await saveAndAnnounce(project, row, { edited: true, quiet: options.quiet })
  await followPublication(project, row)
}

/**
 * A newsletter scheduled with a post waits for it: moved back to a draft when
 * the post is, and later when the post is.
 */
async function followPublication(project: ParseObject, row: ParseObject): Promise<void> {
  const id = pointerId(row.get('newsletterCampaign'))
  if (!id) return
  const campaign = await new (useParse()).Query('Campaign').equalTo('project', project).equalTo('objectId', id).first(MASTER)
  if (!campaign || campaign.get('status') !== 'scheduled') return
  const at = row.get('publishedAt') as Date | undefined
  const sendAt = campaign.get('scheduledAt') as Date | undefined
  if (statusOf(row) !== 'published' || blogPostTypeOf(row) === 'page') campaign.set('status', 'draft')
  else if (at && sendAt && at.getTime() > sendAt.getTime()) campaign.set('scheduledAt', at)
  else return
  await campaign.save(null, MASTER)
}

/** A post and its comments go; a newsletter it went out as stays in Campaigns, with its numbers. */
export async function deleteBlogPost(project: ParseObject, row: ParseObject): Promise<void> {
  const Parse = useParse()
  const event: BlogEvent | null = row.get('announced') === true ? { type: 'blog.post.deleted', data: { post: blogWebhookPost(project, row) } } : null
  for (;;) {
    const comments = await new Parse.Query('BlogComment').equalTo('post', row).limit(500).find(MASTER)
    if (!comments.length) break
    await Parse.Object.destroyAll(comments, MASTER)
  }
  await row.destroy(MASTER)
  if (event) await emitDomainEvent(project, event.type, event.data)
}

// ---- reactions -------------------------------------------------------------------

/**
 * Toggle (or set, with `want`) one reaction of the caller's on a live post.
 * Stored as `"key:actor"` strings changed with $addToSet/$pull, so two readers
 * reacting at once never overwrite each other.
 * ponytail: an array on the row, as feedback does — fine for thousands per post; a BlogReaction class if it ever outgrows that.
 */
export async function reactToBlogPost(ctx: BlogContext, row: ParseObject, key: unknown, want?: unknown): Promise<ParseObject> {
  if (ctx.actor.kind === 'anonymous') throw createError({ statusCode: 401, statusMessage: 'Sign in to react' })
  if (!ctx.config.reactions) throw createError({ statusCode: 403, statusMessage: 'Reactions are turned off' })
  if (!isBlogReaction(key)) badRequest([`reaction must be one of ${BLOG_REACTIONS.join(', ')}`])
  if (!isBlogPostRowLive(row)) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  if (blogPostTypeOf(row) === 'page') throw createError({ statusCode: 403, statusMessage: 'Pages take no reactions' })
  if (visibilityOf(row) === 'members' && !isBlogMember(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'Confirm your email to react to members-only posts' })
  if (ctx.actor.kind === 'user') await rateLimit(`sb:rl:blogreact:${ctx.project.id}:${ctx.actor.externalId}`, LIMITS.blogReactionsPerUser.limit, LIMITS.blogReactionsPerUser.window)
  const entry = blogReactionEntry(key, blogActorId(ctx.actor))
  const has = stringList(row.get('reactions')).includes(entry)
  const on = typeof want === 'boolean' ? want : !has
  if (on === has) return row
  if (on) row.addUnique('reactions', entry)
  else row.remove('reactions', entry)
  await row.save(null, MASTER)
  return await new (useParse()).Query('BlogPost').get(row.id || '', MASTER)
}

// ---- newsletter ------------------------------------------------------------------

/**
 * Email a published post to the project's subscribers, as a campaign: the
 * same audience rules, unsubscribe links, postal address, log, numbers and
 * pause/resume as any other, and Pro in the cloud like campaigns are. The
 * email is built from the post when sending starts (blogNewsletter.ts), so a
 * fix made before then goes out too. `send`: `now`, `schedule` (with
 * `scheduledAt`) or nothing for a draft to look at under Campaigns first.
 * A post goes out once: its campaign can be resent only after it was canceled.
 * A scheduled post's newsletter waits for it: "now" means when it goes live,
 * and a later time is fine, an earlier one is not.
 */
export async function createBlogNewsletter(project: ParseObject, row: ParseObject, payload: unknown): Promise<ParseObject> {
  await assertFeature(await projectWorkspaceId(project), 'campaigns')
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (blogPostTypeOf(row) === 'page') badRequest(['Pages are not sent as newsletters'])
  if (statusOf(row) !== 'published') badRequest(['Publish the post first (or schedule it): the newsletter links to it'])
  const goesLiveAt = isBlogPostRowLive(row) ? null : row.get('publishedAt') as Date
  let send = raw.send
  let scheduledAt = raw.scheduledAt
  if (goesLiveAt && send === 'now') {
    send = 'schedule'
    scheduledAt = goesLiveAt.toISOString()
  } else if (goesLiveAt && send === 'schedule' && new Date(String(scheduledAt || '')).getTime() < goesLiveAt.getTime()) {
    badRequest(['The newsletter cannot go out before the post is published'])
  }
  const Parse = useParse()
  const previousId = pointerId(row.get('newsletterCampaign'))
  const previous = previousId ? await new Parse.Query('Campaign').equalTo('project', project).equalTo('objectId', previousId).first(MASTER) : undefined
  if (previous && previous.get('status') !== 'draft' && previous.get('status') !== 'canceled') {
    throw createError({ statusCode: 409, statusMessage: 'This post already went out as a newsletter (see Campaigns)' })
  }
  const campaign = previous?.get('status') === 'draft' ? previous : new (Parse.Object.extend('Campaign'))() as ParseObject
  if (campaign !== previous) {
    campaign.set('project', project)
    campaign.set('status', 'draft')
    campaign.set('stats', { ...EMPTY_CAMPAIGN_STATS })
  }
  const config = getBlogConfig(project)
  const audience = (raw.audience && typeof raw.audience === 'object' ? raw.audience : { topic: config.newsletterTopic }) as Record<string, unknown>
  const title = String(row.get('title') || '')
  await applyCampaignInput(project, campaign, {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : `Blog: ${title}`,
    // A title is text: `{{` in it must not become a placeholder. A subject you write may use them.
    subject: typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject : literalBraceText(title),
    audience,
    ...(typeof raw.testMode === 'boolean' ? { testMode: raw.testMode } : {})
  })
  campaign.set('blogPost', row)
  campaign.set('template', '')
  campaign.set('templateName', 'Blog post')
  if (send === 'now' || send === 'schedule') await moveCampaign(project, campaign, send === 'now' ? 'sending' : 'scheduled', scheduledAt)
  else if (send !== undefined && send !== null && send !== 'draft') badRequest(['send is now, schedule or draft'])
  await campaign.save(null, MASTER)
  row.set('newsletterCampaign', campaign)
  await row.save(null, MASTER)
  // "Send now": start it in this request rather than on the next worker tick.
  if (campaign.get('status') === 'scheduled' && (campaign.get('scheduledAt') as Date).getTime() <= Date.now()) void runCampaign(campaign.id || '').catch(error => console.error('[blog] newsletter start failed:', (error as Error).message))
  return campaign
}
