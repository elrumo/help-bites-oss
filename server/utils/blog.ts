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
  type BlogConfig,
  type BlogPost,
  type BlogPostStatus,
  type PublicBlog,
  type PublicBlogPost
} from '#shared/blog'
import { EMPTY_CAMPAIGN_STATS } from '#shared/marketing'
import { literalBraceText } from './blogRender'
import { anonymousWriteGate } from './endUserSessions'
import type { IdentityClaims } from './jwt'

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
    if (event.method !== 'GET' && event.method !== 'HEAD') await anonymousWriteGate(project, claims)
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

export function serializeBlogPost(project: ParseObject, row: ParseObject): BlogPost {
  const campaign = row.get('newsletterCampaign') as ParseObject | undefined
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    title: String(row.get('title') || ''),
    slug: String(row.get('slug') || ''),
    excerpt: String(row.get('excerpt') || ''),
    excerptWritten: row.get('excerptWritten') === true,
    body: String(row.get('body') || ''),
    bodyHtml: String(row.get('bodyHtml') || ''),
    coverImageUrl: String(row.get('coverImageUrl') || ''),
    tags: stringList(row.get('tags')),
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

export function serializePublicBlogPost(project: ParseObject, config: BlogConfig, row: ParseObject, viewerId: string, options: { body?: boolean } = {}): PublicBlogPost {
  return {
    id: row.id || '',
    slug: String(row.get('slug') || ''),
    title: String(row.get('title') || ''),
    excerpt: String(row.get('excerpt') || ''),
    ...(options.body ? { bodyHtml: String(row.get('bodyHtml') || '') } : {}),
    coverImageUrl: String(row.get('coverImageUrl') || ''),
    tags: stringList(row.get('tags')),
    publishedAt: iso(row.get('publishedAt')) || '',
    authorName: String(row.get('authorName') || ''),
    readingMinutes: Number(row.get('readingMinutes') || 1),
    commentsOpen: config.comments && row.get('commentsOpen') !== false,
    commentCount: config.comments ? Number(row.get('commentCount') || 0) : 0,
    reactions: config.reactions ? summarizeBlogReactions(row.get('reactions'), viewerId || undefined) : [],
    url: blogPostUrl(project, row)
  }
}

// ---- lists -----------------------------------------------------------------------

export type BlogPostFilter = { status?: BlogPostStatus, tag?: string }

/** Every post of a project for the team: drafts first, then the newest published (up to 1,000). */
export async function listBlogPosts(project: ParseObject, filter: BlogPostFilter = {}): Promise<ParseObject[]> {
  const query = new (useParse()).Query('BlogPost').equalTo('project', project).include('newsletterCampaign').exclude('body').exclude('bodyHtml')
  if (filter.status) query.equalTo('status', filter.status)
  if (filter.tag) query.equalTo('tagKeys', filter.tag.toLowerCase())
  const rows = await query.descending('updatedAt').limit(1000).find(MASTER)
  const when = (row: ParseObject) => statusOf(row) === 'draft' ? Infinity : ((row.get('publishedAt') as Date | undefined)?.getTime() || 0)
  return rows.sort((a, b) => when(b) - when(a))
}

/** The published posts, newest first, a page at a time. */
export async function listPublicBlog(ctx: BlogContext, page: { limit: number, skip: number, tag?: string }): Promise<PublicBlog> {
  const build = () => {
    const query = new (useParse()).Query('BlogPost').equalTo('project', ctx.project).equalTo('status', 'published').lessThanOrEqualTo('publishedAt', new Date())
    if (page.tag) query.equalTo('tagKeys', page.tag.toLowerCase())
    return query
  }
  const [rows, total] = await Promise.all([
    build().exclude('body').exclude('bodyHtml').descending('publishedAt').skip(page.skip).limit(page.limit).find(MASTER),
    build().count(MASTER)
  ])
  const viewer = blogActorId(ctx.actor)
  return {
    title: blogTitle(ctx.config, String(ctx.project.get('name') || '')),
    description: ctx.config.description,
    feedUrl: blogFeedUrl(ctx.project),
    reactions: ctx.config.reactions,
    comments: ctx.config.comments,
    subscribeForm: ctx.config.subscribeForm,
    posts: rows.map(row => serializePublicBlogPost(ctx.project, ctx.config, row, viewer)),
    total,
    hasMore: page.skip + rows.length < total
  }
}

export function readBlogPage(query: Record<string, unknown>): { limit: number, skip: number, tag?: string } {
  const whole = (raw: unknown, fallback: number, min: number, max: number) => {
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) badRequest([`limit and skip must be whole numbers (limit up to ${BLOG_PAGE_MAX})`])
    return n
  }
  const tag = typeof query.tag === 'string' && query.tag.trim() ? query.tag.trim().slice(0, 40) : undefined
  return { limit: whole(query.limit, 20, 1, BLOG_PAGE_MAX), skip: whole(query.skip, 0, 0, 100_000), tag }
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
  if (values.body !== undefined) {
    row.set('body', values.body)
    row.set('bodyHtml', renderBlogBody(values.body))
    row.set('readingMinutes', blogBodyStats(values.body).readingMinutes)
  }
  if (values.excerpt !== undefined) row.set('excerptWritten', Boolean(values.excerpt))
  // A written lead-in stays as written; otherwise it follows the body.
  if (values.excerpt) row.set('excerpt', values.excerpt)
  else if (row.get('excerptWritten') !== true) row.set('excerpt', deriveBlogExcerpt(String(row.get('body') || '')))
  if (values.coverImageUrl !== undefined) row.set('coverImageUrl', values.coverImageUrl)
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

export async function createBlogPost(project: ParseObject, agent: ParseObject | null, payload: unknown): Promise<ParseObject> {
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
  await applyBlogPostInput(project, row, payload, true)
  await row.save(null, MASTER)
  return row
}

export async function updateBlogPost(project: ParseObject, row: ParseObject, payload: unknown): Promise<void> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (typeof raw.authorName === 'string') row.set('authorName', raw.authorName.trim().slice(0, 120))
  await applyBlogPostInput(project, row, payload, false)
  await row.save(null, MASTER)
}

/** A post and its comments go; a newsletter it went out as stays in Campaigns, with its numbers. */
export async function deleteBlogPost(row: ParseObject): Promise<void> {
  const Parse = useParse()
  for (;;) {
    const comments = await new Parse.Query('BlogComment').equalTo('post', row).limit(500).find(MASTER)
    if (!comments.length) break
    await Parse.Object.destroyAll(comments, MASTER)
  }
  await row.destroy(MASTER)
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
 */
export async function createBlogNewsletter(project: ParseObject, row: ParseObject, payload: unknown): Promise<ParseObject> {
  await assertFeature(await projectWorkspaceId(project), 'campaigns')
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (!isBlogPostRowLive(row)) badRequest(['Publish the post first: the newsletter links to it'])
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
  if (raw.send === 'now' || raw.send === 'schedule') await moveCampaign(project, campaign, raw.send === 'now' ? 'sending' : 'scheduled', raw.scheduledAt)
  else if (raw.send !== undefined && raw.send !== null && raw.send !== 'draft') badRequest(['send is now, schedule or draft'])
  await campaign.save(null, MASTER)
  row.set('newsletterCampaign', campaign)
  await row.save(null, MASTER)
  // "Send now": start it in this request rather than on the next worker tick.
  if (campaign.get('status') === 'scheduled' && (campaign.get('scheduledAt') as Date).getTime() <= Date.now()) void runCampaign(campaign.id || '').catch(error => console.error('[blog] newsletter start failed:', (error as Error).message))
  return campaign
}
