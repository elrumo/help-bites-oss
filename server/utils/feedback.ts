import { createError, getHeader, getQuery, type H3Event } from 'h3'
import { normalizeEmail } from '#shared/contacts'
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_REACTIONS,
  defaultFeedbackStatus,
  feedbackPlainText,
  feedbackPostUrl,
  feedbackReactionEntry,
  feedbackSlug,
  feedbackStatusCategory,
  feedbackStatusDefinition,
  isFeedbackReaction,
  normalizeFeedbackConfig,
  normalizeFeedbackKey,
  parseFeedbackMentions,
  parseFeedbackRefs,
  parsePostRef,
  readFeedbackPostInput,
  summarizeFeedbackReactions,
  votingOpen,
  type FeedbackAuthor,
  type FeedbackBoardConfig,
  type FeedbackComment,
  type FeedbackCommentVisibility,
  type FeedbackEvent,
  type FeedbackParticipant,
  type FeedbackPost,
  type FeedbackPostRef,
  type FeedbackPostValues,
  type FeedbackStatusConfig,
  type FeedbackViewer
} from '#shared/feedback'
import { anonymousWriteGate, revokeEndUserSessions } from './endUserSessions'
import type { IdentityClaims } from './jwt'
import type { OutgoingEmail } from './emailDelivery'

type ParseQuery = InstanceType<ReturnType<typeof useParse>['Query']>

// Feedback boards: public, per-project posts with votes and comments. Like the
// rest of HelpBites every row is master-only and every rule lives here, so the
// three kinds of caller see one consistent board:
//
//   anonymous  `?pk=` (or X-Project-Key) — reads the public board
//   user       a host-signed identity token — posts, votes, comments; with the
//              `role: "admin"` claim the host's own staff also moderate
//   agent      an operator session or admin key — the panel; moderates
//
// Authors and voters are stored by the host's own user id (the token's `sub`),
// the same key EndUser rows use, so history imported from another system keeps
// its votes and authorship without inventing users.

// ---- who is asking ----------------------------------------------------------

export type FeedbackActor =
  | { kind: 'anonymous' }
  | { kind: 'user', externalId: string, name: string, isAdmin: boolean, claims: IdentityClaims }
  | { kind: 'agent', agent: ParseObject }

export type FeedbackContext = { project: ParseObject, config: FeedbackBoardConfig, actor: FeedbackActor }

export function isFeedbackAdmin(actor: FeedbackActor): boolean {
  return actor.kind === 'agent' || (actor.kind === 'user' && actor.isAdmin)
}

export function feedbackViewer(actor: FeedbackActor): FeedbackViewer {
  if (actor.kind === 'agent') return { signedIn: true, isAdmin: true, name: String(actor.agent.get('name') || actor.agent.get('username') || '') }
  if (actor.kind === 'user') return { signedIn: true, isAdmin: actor.isAdmin, name: actor.name }
  return { signedIn: false, isAdmin: false, name: '' }
}

/** Who a reaction belongs to: the host's user id, or the operator. */
export function feedbackActorId(actor: FeedbackActor): string {
  if (actor.kind === 'user') return actor.externalId
  if (actor.kind === 'agent') return `agent:${actor.agent.id}`
  return ''
}

export function getFeedbackConfig(project: ParseObject): FeedbackBoardConfig {
  return normalizeFeedbackConfig(project.get('feedback'))
}

function boardMustBeOn(config: FeedbackBoardConfig, actor: FeedbackActor) {
  // Operators can always reach it — that is how a board gets set up.
  if (!config.enabled && actor.kind !== 'agent') throw createError({ statusCode: 404, statusMessage: 'This project has no feedback board' })
}

/**
 * Resolve the project and caller for a feedback request. `projectId` pins the
 * project (per-post routes pass the post's own), which agents need — they may
 * act on any project of their workspace — and which a token or key for
 * another project must match.
 */
export async function resolveFeedbackContext(event: H3Event, options: { projectId?: string, requireActor?: boolean } = {}): Promise<FeedbackContext> {
  const token = optionalBearer(event)
  const query = getQuery(event)

  if (token.startsWith('r:') || token.startsWith('ak_')) {
    const member = await requireMember(event, { can: 'content' })
    const id = options.projectId || String(query.project || '')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
    const project = await requireProject(member, id)
    return { project, config: getFeedbackConfig(project), actor: { kind: 'agent', agent: member.agent } }
  }

  if (token) {
    const { project, claims } = await verifyEndUserToken(event, token)
    if (options.projectId && project.id !== options.projectId) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
    // Email-only users get a few free writes, then must verify their address.
    if (event.method !== 'GET' && event.method !== 'HEAD') await anonymousWriteGate(project, claims)
    const actor: FeedbackActor = { kind: 'user', externalId: claims.sub, name: String(claims.name || '').trim().slice(0, 120), isAdmin: claims.role === 'admin', claims }
    const config = getFeedbackConfig(project)
    boardMustBeOn(config, actor)
    return { project, config, actor }
  }

  if (options.requireActor) throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })

  const pk = String(query.pk || getHeader(event, 'x-project-key') || '').trim()
  if (!pk) throw createError({ statusCode: 401, statusMessage: 'Pass ?pk=<public key> or an identity token' })
  const project = await findProjectByPublicKey(pk)
  if (!project || (options.projectId && project.id !== options.projectId)) throw createError({ statusCode: 404, statusMessage: options.projectId ? 'Post not found' : 'Unknown project' })
  await rateLimit(`sb:rl:fbread:${clientIp(event) || 'ip'}`, LIMITS.feedbackReadsPerIp.limit, LIMITS.feedbackReadsPerIp.window)
  const actor: FeedbackActor = { kind: 'anonymous' }
  const config = getFeedbackConfig(project)
  boardMustBeOn(config, actor)
  return { project, config, actor }
}

function postQuery(): ParseQuery {
  return new (useParse()).Query('FeedbackPost').include('endUser').include('duplicateOf')
}

/** A post in a project by any of its names: object id, imported `externalId`, or `123` / `123-slug`. */
export async function findFeedbackPost(project: ParseObject, id: string): Promise<ParseObject | undefined> {
  if (!id) return undefined
  const byId = await postQuery().equalTo('project', project).equalTo('objectId', id).first(MASTER)
  if (byId) return byId
  const byExternalId = await postQuery().equalTo('project', project).equalTo('externalId', id).first(MASTER)
  if (byExternalId) return byExternalId
  const number = parsePostRef(id)
  return number ? postQuery().equalTo('project', project).equalTo('number', number).first(MASTER) : undefined
}

/**
 * Load a post for a per-post route. The id may also be the host's own
 * `externalId` (imported history keeps old deep links working) or the post's
 * number. Hidden posts are invisible to everyone but admins, their authors included.
 */
export async function loadFeedbackPost(event: H3Event, rawId: string, options: { requireActor?: boolean } = {}): Promise<{ ctx: FeedbackContext, post: ParseObject }> {
  let id = rawId
  try { id = decodeURIComponent(rawId) } catch {}
  const token = optionalBearer(event)
  const isAgent = token.startsWith('r:') || token.startsWith('ak_')

  if (isAgent) {
    const member = await requireMember(event, { can: 'content' })
    let post = await postQuery().get(id, MASTER).catch(() => undefined)
    // Numbers and external ids are per project: operators name it.
    const projectId = String(getQuery(event).project || '')
    if (!post && projectId) post = await findFeedbackPost(await requireProject(member, projectId), id)
    if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
    const ctx = await resolveFeedbackContext(event, { projectId: pointerId(post.get('project')), requireActor: options.requireActor })
    return { ctx, post }
  }

  const ctx = await resolveFeedbackContext(event, { requireActor: options.requireActor })
  const post = await findFeedbackPost(ctx.project, id)
  if (!post || (post.get('hidden') === true && !isFeedbackAdmin(ctx.actor))) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  return { ctx, post }
}

// ---- serializers ------------------------------------------------------------

type AuthorRow = { authorExternalId: string, authorName: string, authorIsTeam: boolean, endUser: ParseObject | null }

function authorOf(row: ParseObject): AuthorRow {
  const endUser = row.get('endUser') as ParseObject | undefined
  return {
    authorExternalId: String(row.get('authorExternalId') || ''),
    authorName: String(row.get('authorName') || ''),
    authorIsTeam: row.get('authorIsTeam') === true,
    endUser: endUser && typeof endUser.get === 'function' ? endUser : null
  }
}

export function serializeFeedbackAuthor(author: AuthorRow, config: FeedbackBoardConfig, admin: boolean): FeedbackAuthor | null {
  if (!author.authorExternalId && !author.authorIsTeam && !author.authorName) return null
  const showName = admin || author.authorIsTeam || config.showAuthorNames
  const out: FeedbackAuthor = {
    name: showName ? author.authorName : '',
    isTeam: author.authorIsTeam,
    handle: showName ? String(author.endUser?.get('username') || '') : '',
    avatarUrl: showName ? String(author.endUser?.get('avatarUrl') || '') : ''
  }
  if (admin) {
    out.externalId = author.authorExternalId
    const email = String(author.endUser?.get('email') || '')
    if (email) out.email = email
  }
  return out
}

/** Who may do what to a post or comment: the one rule set every route uses. */
export function feedbackPermissions(actor: FeedbackActor, authorExternalId: string, config: FeedbackBoardConfig): { isMine: boolean, canEdit: boolean, canDelete: boolean } {
  const isMine = actor.kind === 'user' && Boolean(authorExternalId) && actor.externalId === authorExternalId
  const admin = isFeedbackAdmin(actor)
  return { isMine, canEdit: admin || (isMine && config.allowUserEdits), canDelete: admin || isMine }
}

/** Commenting and voting, with locks and closed statuses applied. */
export function feedbackParticipation(actor: FeedbackActor, config: FeedbackBoardConfig, post: { locked: boolean, statusCategory: FeedbackPost['statusCategory'] }): { canComment: boolean, canVote: boolean } {
  const admin = isFeedbackAdmin(actor)
  return {
    canComment: actor.kind !== 'anonymous' && (admin || (config.allowComments && !post.locked)),
    canVote: actor.kind === 'user' && votingOpen(post.statusCategory) && (admin || !post.locked)
  }
}

function date(value: unknown): string | null {
  return iso(value)
}

function numberOf(row: ParseObject): number | null {
  const value = row.get('number')
  return typeof value === 'number' && value > 0 ? value : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(n => Number.isSafeInteger(n) && n > 0) : []
}

export function feedbackPostRef(row: ParseObject, config: FeedbackBoardConfig): FeedbackPostRef {
  const status = String(row.get('status') || defaultFeedbackStatus(config).key)
  return { id: row.id || '', number: numberOf(row), title: String(row.get('title') || ''), status, statusCategory: feedbackStatusCategory(config, status) }
}

/** What the viewer has to do with a page of posts: their votes and follows. */
export type FeedbackViewerState = { voted: Set<string>, subscriptions: Map<string, ParseObject> }

export async function feedbackViewerState(ctx: FeedbackContext, postIds: string[]): Promise<FeedbackViewerState> {
  const state: FeedbackViewerState = { voted: new Set(), subscriptions: new Map() }
  if (ctx.actor.kind !== 'user' || !postIds.length) return state
  const Parse = useParse()
  const pointers = postIds.map(id => Parse.Object.extend('FeedbackPost').createWithoutData(id))
  const externalId = ctx.actor.externalId
  // A roadmap can link more posts than one read returns.
  await Promise.all([
    eachBatch(() => new Parse.Query('FeedbackVote').equalTo('project', ctx.project).equalTo('voterId', externalId).containedIn('post', pointers), (votes) => {
      for (const vote of votes) state.voted.add(pointerId(vote.get('post')))
    }),
    eachBatch(() => new Parse.Query('FeedbackSubscription').equalTo('project', ctx.project).equalTo('subscriberId', externalId).containedIn('post', pointers), (subscriptions) => {
      for (const sub of subscriptions) state.subscriptions.set(pointerId(sub.get('post')), sub)
    })
  ])
  return state
}

/** Unread: followed, and something happened after the viewer last read it (or followed it). */
export function feedbackUnread(lastActivityAt: Date | undefined, subscription: { lastReadAt?: Date, createdAt?: Date } | undefined): boolean {
  if (!subscription || !lastActivityAt) return false
  const seen = subscription.lastReadAt || subscription.createdAt
  return !seen || lastActivityAt.getTime() > seen.getTime()
}

/** `viewer` set → viewer fields included; omitted → the viewer-neutral shape live events carry. */
export function serializeFeedbackPost(row: ParseObject, ctx: FeedbackContext, viewer?: FeedbackViewerState): FeedbackPost {
  const admin = isFeedbackAdmin(ctx.actor)
  const author = authorOf(row)
  const status = String(row.get('status') || defaultFeedbackStatus(ctx.config).key)
  const title = String(row.get('title') || '')
  const duplicateOf = row.get('duplicateOf') as ParseObject | undefined
  const post: FeedbackPost = {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    number: numberOf(row),
    slug: feedbackSlug(title),
    title,
    body: String(row.get('body') || ''),
    type: String(row.get('type') || ''),
    platform: String(row.get('platform') || ''),
    tags: stringList(row.get('tags')),
    status,
    statusCategory: feedbackStatusCategory(ctx.config, status),
    voteCount: Number(row.get('voteCount') || 0),
    commentCount: Number(row.get('commentCount') || 0),
    author: serializeFeedbackAuthor(author, ctx.config, admin),
    hidden: row.get('hidden') === true,
    featured: row.get('featured') === true,
    locked: row.get('locked') === true,
    showOnChangelog: row.get('showOnChangelog') === true,
    ...changelogDraft(row),
    icon: String(row.get('icon') || ''),
    pinnedCommentId: String(row.get('pinnedCommentId') || '') || null,
    // A pointer without its data (not included) still names the post.
    duplicateOf: duplicateOf?.id ? (duplicateOf.get('title') === undefined ? { id: duplicateOf.id, number: null, title: '', status: '', statusCategory: 'open' } : feedbackPostRef(duplicateOf, ctx.config)) : null,
    refs: numberList(row.get('refs')),
    reactions: summarizeFeedbackReactions(row.get('reactions'), viewer ? feedbackActorId(ctx.actor) : undefined),
    editedAt: date(row.get('editedAt')),
    completedAt: date(row.get('completedAt')),
    statusChangedAt: date(row.get('statusChangedAt')),
    lastActivityAt: date(row.get('lastActivityAt')),
    createdAt: date(row.get('postedAt')) || date(row.createdAt) || '',
    updatedAt: date(row.updatedAt) || ''
  }
  if (admin) {
    post.externalId = String(row.get('externalId') || '')
    post.metadata = (row.get('metadata') as Record<string, unknown>) || {}
    post.adminNote = String(row.get('adminNote') || '')
  }
  if (viewer) {
    const subscription = viewer.subscriptions.get(post.id)
    Object.assign(post, {
      hasVoted: viewer.voted.has(post.id),
      ...feedbackPermissions(ctx.actor, author.authorExternalId, ctx.config),
      ...feedbackParticipation(ctx.actor, ctx.config, post),
      subscribed: Boolean(subscription),
      muted: subscription?.get('muted') === true,
      unread: feedbackUnread(row.get('lastActivityAt') as Date | undefined, subscription ? { lastReadAt: subscription.get('lastReadAt') as Date | undefined, createdAt: subscription.createdAt } : undefined)
    })
  }
  return admin ? post : withoutChangelogDraft(post)
}

function changelogDraft(row: ParseObject): Pick<FeedbackPost, 'changelogTitle' | 'changelogBody' | 'shippedIn'> {
  return { changelogTitle: String(row.get('changelogTitle') || ''), changelogBody: String(row.get('changelogBody') || ''), shippedIn: String(row.get('shippedIn') || '') }
}

/** Changelog copy and the version are the team's drafts until the post is on the changelog. */
export function withoutChangelogDraft(post: FeedbackPost): FeedbackPost {
  if (post.showOnChangelog && post.statusCategory === 'done') return post
  return { ...post, changelogTitle: '', changelogBody: '', shippedIn: '' }
}

function commentVisibility(row: ParseObject): FeedbackCommentVisibility {
  const value = row.get('visibility')
  return value === 'internal' || value === 'hidden' ? value : 'public'
}

export function serializeFeedbackComment(row: ParseObject, ctx: FeedbackContext, withViewer = true): FeedbackComment {
  const author = authorOf(row)
  const comment: FeedbackComment = {
    id: row.id || '',
    postId: pointerId(row.get('post')),
    parentId: String(row.get('parentId') || '') || null,
    replyToId: String(row.get('replyToId') || '') || null,
    visibility: commentVisibility(row),
    body: String(row.get('body') || ''),
    author: serializeFeedbackAuthor(author, ctx.config, isFeedbackAdmin(ctx.actor)),
    reactions: summarizeFeedbackReactions(row.get('reactions'), withViewer ? feedbackActorId(ctx.actor) : undefined),
    refs: numberList(row.get('refs')),
    editedAt: date(row.get('editedAt')),
    createdAt: date(row.get('postedAt')) || date(row.createdAt) || ''
  }
  if (withViewer) Object.assign(comment, feedbackPermissions(ctx.actor, author.authorExternalId, ctx.config))
  return comment
}

/** Live events go to every viewer, so they carry the anonymous view of a row. */
function publicContext(ctx: FeedbackContext): FeedbackContext {
  return { ...ctx, actor: { kind: 'anonymous' } }
}

function publishPost(ctx: FeedbackContext, row: ParseObject, type: 'feedback.post.created' | 'feedback.post.updated' = 'feedback.post.updated'): Promise<void> {
  // Admin panels merge live posts over their copy, so the draft rides along; feedbackEventForViewer drops it for everyone else.
  return publishFeedbackEvent({ type, projectId: ctx.project.id || '', postId: row.id || '', post: { ...serializeFeedbackPost(row, publicContext(ctx)), ...changelogDraft(row) } })
}

function publishComment(ctx: FeedbackContext, row: ParseObject, comment: ParseObject, type: 'feedback.comment.created' | 'feedback.comment.updated'): Promise<void> {
  return publishFeedbackEvent({ type, projectId: ctx.project.id || '', postId: row.id || '', comment: serializeFeedbackComment(comment, publicContext(ctx), false), commentCount: Number(row.get('commentCount') || 0), postHidden: row.get('hidden') === true })
}

// ---- reads ------------------------------------------------------------------

export type FeedbackListQuery = {
  view: 'board' | 'roadmap' | 'changelog'
  statuses: string[]
  types: string[]
  platforms: string[]
  tags: string[]
  featured: boolean | null
  q: string
  sort: 'top' | 'new' | 'activity' | 'completed'
  mine: boolean
  subscribed: boolean
  includeHidden: boolean
  limit: number
  offset: number
}

function csv(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',')
  return list.map(v => String(v).trim()).filter(Boolean).slice(0, 40)
}

function flag(value: unknown): boolean {
  return ['1', 'true', 'yes'].includes(String(value))
}

export function readFeedbackListQuery(query: Record<string, unknown>, config: FeedbackBoardConfig): FeedbackListQuery {
  const view = query.view === 'roadmap' || query.view === 'changelog' ? query.view : 'board'
  // `category` is the portable filter: it means the same on every board.
  const categories = csv(query.category)
  const statuses = [...csv(query.status), ...config.statuses.filter(s => categories.includes(s.category)).map(s => s.key)]
  if (categories.length && !statuses.length) statuses.push('__none__')
  const sorts = ['top', 'new', 'activity', 'completed'] as const
  const sort = (sorts as readonly string[]).includes(String(query.sort)) ? query.sort as FeedbackListQuery['sort'] : (view === 'changelog' ? 'completed' : 'top')
  const limit = Math.min(Math.max(Number.parseInt(String(query.limit || ''), 10) || 100, 1), 500)
  const offset = Math.max(Number.parseInt(String(query.offset || ''), 10) || 0, 0)
  return {
    view,
    statuses,
    types: csv(query.type),
    platforms: csv(query.platform),
    tags: csv(query.tag),
    featured: query.featured === undefined || query.featured === '' ? null : flag(query.featured),
    q: String(query.q || '').trim().slice(0, 200),
    sort,
    mine: flag(query.mine),
    subscribed: flag(query.subscribed),
    includeHidden: flag(query.includeHidden),
    limit,
    offset
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function listFeedbackPosts(ctx: FeedbackContext, input: FeedbackListQuery): Promise<{ posts: FeedbackPost[], total: number }> {
  const Parse = useParse()
  const admin = isFeedbackAdmin(ctx.actor)

  let query: ParseQuery
  if (input.q) {
    const pattern = escapeRegex(input.q)
    query = Parse.Query.or(
      new Parse.Query('FeedbackPost').matches('title', pattern, 'i'),
      new Parse.Query('FeedbackPost').matches('body', pattern, 'i')
    )
  } else {
    query = new Parse.Query('FeedbackPost')
  }
  query.equalTo('project', ctx.project)
  if (!admin || !input.includeHidden) query.notEqualTo('hidden', true)

  let statuses = input.statuses
  if (input.view === 'changelog') {
    const done = ctx.config.statuses.filter(s => s.category === 'done').map(s => s.key)
    statuses = statuses.length ? statuses.filter(s => done.includes(s)) : done
    query.equalTo('showOnChangelog', true)
  } else if (input.view === 'roadmap') {
    const roadmap = ctx.config.statuses.filter(s => s.category === 'planned' || s.category === 'active' || s.category === 'done').map(s => s.key)
    statuses = statuses.length ? statuses.filter(s => roadmap.includes(s)) : roadmap
  }
  if (statuses.length || input.view !== 'board') query.containedIn('status', statuses.length ? statuses : ['__none__'])
  if (input.types.length) query.containedIn('type', input.types)
  if (input.platforms.length) query.containedIn('platform', input.platforms)
  if (input.tags.length) query.containedIn('tags', input.tags)
  if (input.featured !== null) {
    if (input.featured) query.equalTo('featured', true)
    else query.notEqualTo('featured', true)
  }
  if (input.mine) {
    if (ctx.actor.kind !== 'user') return { posts: [], total: 0 }
    query.equalTo('authorExternalId', ctx.actor.externalId)
  }
  if (input.subscribed) {
    if (ctx.actor.kind !== 'user') return { posts: [], total: 0 }
    // ponytail: a follower's first 1000 subscriptions; page them if anyone follows more.
    const subscriptions = await new Parse.Query('FeedbackSubscription').equalTo('project', ctx.project).equalTo('subscriberId', ctx.actor.externalId).select('post').limit(1000).find(MASTER)
    query.containedIn('objectId', subscriptions.map(sub => pointerId(sub.get('post'))))
  }

  if (input.sort === 'top') query.descending('voteCount').addDescending('postedAt')
  else if (input.sort === 'activity') query.descending('lastActivityAt').addDescending('postedAt')
  else if (input.sort === 'completed') query.descending('completedAt').addDescending('postedAt')
  else query.descending('postedAt')

  query.include('endUser').include('duplicateOf')
  query.limit(input.limit).skip(input.offset).withCount(true)
  const { results, count } = await query.find(MASTER) as unknown as { results: ParseObject[], count: number }
  const viewer = await feedbackViewerState(ctx, results.map(row => row.id || ''))
  return { posts: results.map(row => serializeFeedbackPost(row, ctx, viewer)), total: count }
}

/** Team notes and moderated comments are for admins only. */
function visibleComments(query: ParseQuery, ctx: FeedbackContext): ParseQuery {
  if (!isFeedbackAdmin(ctx.actor)) query.notContainedIn('visibility', ['internal', 'hidden'])
  return query
}

export async function listFeedbackComments(ctx: FeedbackContext, post: ParseObject): Promise<FeedbackComment[]> {
  const query = visibleComments(new (useParse()).Query('FeedbackComment').equalTo('post', post), ctx).ascending('postedAt').limit(1000).include('endUser')
  const rows = await query.find(MASTER)
  return rows.map(row => serializeFeedbackComment(row, ctx))
}

/**
 * The posts this thread links to (`#N` in the post and its comments) and the
 * ones linking back to it, as the viewer may see them. Backlinks are why refs
 * are stored at all: a client can render `#N` itself but cannot find who points here.
 */
export async function feedbackLinks(ctx: FeedbackContext, row: ParseObject, comments: FeedbackComment[]): Promise<{ linked: FeedbackPostRef[], backrefs: FeedbackPostRef[] }> {
  const Parse = useParse()
  const admin = isFeedbackAdmin(ctx.actor)
  const self = numberOf(row)
  const wanted = [...new Set([...numberList(row.get('refs')), ...comments.flatMap(c => c.refs)])].filter(n => n !== self).slice(0, 100)
  const visible = (query: ParseQuery) => (admin ? query : query.notEqualTo('hidden', true))

  const linked = wanted.length
    ? await visible(new Parse.Query('FeedbackPost').equalTo('project', ctx.project).containedIn('number', wanted)).select('title', 'status', 'number').limit(100).find(MASTER)
    : []
  let backrefs: ParseObject[] = []
  if (self) {
    const [posts, commentRows] = await Promise.all([
      visible(new Parse.Query('FeedbackPost').equalTo('project', ctx.project).equalTo('refs', self).notEqualTo('objectId', row.id)).select('title', 'status', 'number').limit(50).find(MASTER),
      visibleComments(new Parse.Query('FeedbackComment').equalTo('project', ctx.project).equalTo('refs', self).notEqualTo('post', row), ctx).include('post').limit(50).find(MASTER)
    ])
    const byId = new Map(posts.map(p => [p.id, p]))
    for (const comment of commentRows) {
      const post = comment.get('post') as ParseObject | undefined
      if (post?.id && !byId.has(post.id) && (admin || post.get('hidden') !== true)) byId.set(post.id, post)
    }
    backrefs = [...byId.values()].sort((a, b) => (numberOf(a) || 0) - (numberOf(b) || 0))
  }
  const order = new Map(wanted.map((n, i) => [n, i]))
  return {
    linked: linked.map(p => feedbackPostRef(p, ctx.config)).sort((a, b) => (order.get(a.number || 0) || 0) - (order.get(b.number || 0) || 0)),
    backrefs: backrefs.map(p => feedbackPostRef(p, ctx.config))
  }
}

// ---- writes -----------------------------------------------------------------

function requireWriter(ctx: FeedbackContext): asserts ctx is FeedbackContext & { actor: Exclude<FeedbackActor, { kind: 'anonymous' }> } {
  if (ctx.actor.kind === 'anonymous') throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })
}

function requireAdmin(ctx: FeedbackContext): void {
  requireWriter(ctx)
  if (!isFeedbackAdmin(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'Only the team can do that' })
}

function badRequest(errors: string[]): never {
  throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
}

function requireUnlocked(ctx: FeedbackContext, row: ParseObject): void {
  if (row.get('locked') === true && !isFeedbackAdmin(ctx.actor)) throw createError({ statusCode: 409, statusMessage: 'This post is locked' })
}

/** Stamp the author fields; a user author also gets an EndUser row so they can be emailed. */
async function stampAuthor(row: ParseObject, ctx: FeedbackContext): Promise<void> {
  const actor = ctx.actor
  if (actor.kind === 'agent') {
    row.set('authorExternalId', '')
    row.set('authorName', agentDisplayName(ctx.project, actor.agent))
    row.set('authorIsTeam', true)
    row.set('agent', actor.agent)
  } else if (actor.kind === 'user') {
    const endUser = await ensureEndUser(ctx.project, actor.claims)
    row.set('authorExternalId', actor.externalId)
    // Names are public on boards that show them, so never fall back to the email.
    row.set('authorName', String(actor.claims.name || endUser.get('name') || endUser.get('username') || '').trim().slice(0, 120))
    row.set('authorIsTeam', actor.isAdmin)
    row.set('endUser', endUser)
  }
}

function applyValues(row: ParseObject, values: FeedbackPostValues): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) row.unset(key)
    else row.set(key, value)
  }
}

/** Status side effects: the change stamp, and `completedAt` the first time a post lands in a done status. */
export function statusTransition(config: FeedbackStatusConfig, from: string, to: string, completedAt: Date | null | undefined, now: Date): { completedAt: Date | null | undefined, changed: boolean } {
  if (from === to) return { completedAt, changed: false }
  const wasDone = feedbackStatusCategory(config, from) === 'done'
  const isDone = feedbackStatusCategory(config, to) === 'done'
  return { completedAt: isDone && !wasDone && !completedAt ? now : completedAt, changed: true }
}

/**
 * The next `#N` in a per-project sequence (`feedbackPostSeq` for posts,
 * `boardItemSeq` for board items). An atomic increment on the project row,
 * then a check that nothing (an import) already holds it.
 * ponytail: no unique index — Parse's schema API cannot create one. Add a
 * partial unique index on {_p_project, number} in Mongo if this ever races.
 */
export async function allocateProjectNumber(project: ParseObject, seqField: 'feedbackPostSeq' | 'boardItemSeq' | 'changelogSeq', className: 'FeedbackPost' | 'BoardItem' | 'ChangelogEntry'): Promise<number> {
  const Parse = useParse()
  for (let attempt = 0; attempt < 5; attempt++) {
    // A fresh object per call: two requests must never share one SDK instance.
    const counter = Parse.Object.extend('Project').createWithoutData(project.id) as ParseObject
    counter.increment(seqField)
    await counter.save(null, MASTER)
    const number = Number(counter.get(seqField))
    if (!(await new Parse.Query(className).equalTo('project', project).equalTo('number', number).first(MASTER))) return number
  }
  throw createError({ statusCode: 503, statusMessage: 'Could not allocate a number; try again' })
}

/** After an import placed numbers by hand, move the counter past them. */
export async function raiseFeedbackNumberCounter(project: ParseObject): Promise<void> {
  const Parse = useParse()
  const top = await new Parse.Query('FeedbackPost').equalTo('project', project).exists('number').descending('number').select('number').first(MASTER)
  const highest = Number(top?.get('number') || 0)
  const fresh = await new Parse.Query('Project').select('feedbackPostSeq').get(project.id || '', MASTER)
  // ponytail: read-then-write; only the project-secret import calls this.
  if (highest > Number(fresh.get('feedbackPostSeq') || 0)) {
    fresh.set('feedbackPostSeq', highest)
    await fresh.save(null, MASTER)
  }
}

async function subscribe(project: ParseObject, row: ParseObject, subscriberIds: string[]): Promise<void> {
  const ids = [...new Set(subscriberIds.filter(Boolean))]
  if (!ids.length) return
  const Parse = useParse()
  const have = new Set<string>()
  await eachBatch(() => new Parse.Query('FeedbackSubscription').equalTo('post', row).containedIn('subscriberId', ids), (existing) => {
    for (const sub of existing) have.add(String(sub.get('subscriberId')))
  }, { keys: ['subscriberId'] })
  const fresh = ids.filter(id => !have.has(id)).map((id) => {
    const sub = new (Parse.Object.extend('FeedbackSubscription'))() as ParseObject
    sub.set('project', project)
    sub.set('post', row)
    sub.set('subscriberId', id)
    sub.set('muted', false)
    // Writing to a thread means you have read it.
    sub.set('lastReadAt', new Date())
    return sub
  })
  if (fresh.length) await Parse.Object.saveAll(fresh, MASTER)
}

/** Re-read a row after an atomic array op, so responses and events carry the stored value. */
async function reload(row: ParseObject): Promise<ParseObject> {
  const query = row.className === 'FeedbackPost' ? postQuery() : new (useParse()).Query(row.className).include('endUser')
  return await query.get(row.id || '', MASTER)
}

export async function createFeedbackPost(ctx: FeedbackContext, payload: unknown): Promise<ParseObject> {
  requireWriter(ctx)
  const admin = isFeedbackAdmin(ctx.actor)
  const { values, errors } = readFeedbackPostInput(payload, ctx.config, { admin, create: true })
  if (errors.length) badRequest(errors)
  if (values.pinnedCommentId) badRequest(['A new post has no comments to pin'])
  if (ctx.actor.kind === 'user') await rateLimit(`sb:rl:fbpost:${ctx.project.id}:${ctx.actor.externalId}`, LIMITS.feedbackPostsPerUser.limit, LIMITS.feedbackPostsPerUser.window)

  const Parse = useParse()
  const now = new Date()
  const row = new (Parse.Object.extend('FeedbackPost'))() as ParseObject
  row.set('project', ctx.project)
  row.set('body', '')
  row.set('type', '')
  row.set('platform', '')
  row.set('tags', [])
  row.set('status', defaultFeedbackStatus(ctx.config).key)
  row.set('hidden', false)
  row.set('featured', false)
  row.set('locked', false)
  row.set('showOnChangelog', false)
  applyValues(row, values)
  row.set('refs', parseFeedbackRefs(String(row.get('body') || '')))
  const { completedAt } = statusTransition(ctx.config, '', String(row.get('status')), values.completedAt, now)
  if (completedAt) row.set('completedAt', completedAt)
  await stampAuthor(row, ctx)
  // Authors start with their own vote, the way every board does.
  const selfVote = ctx.actor.kind === 'user'
  row.set('voteCount', selfVote ? 1 : 0)
  row.set('commentCount', 0)
  row.set('postedAt', now)
  row.set('lastActivityAt', now)
  row.set('statusChangedAt', now)
  row.set('number', await allocateProjectNumber(ctx.project, 'feedbackPostSeq', 'FeedbackPost'))
  await row.save(null, MASTER)

  if (selfVote && ctx.actor.kind === 'user') {
    const vote = new (Parse.Object.extend('FeedbackVote'))()
    vote.set('project', ctx.project)
    vote.set('post', row)
    vote.set('voterId', ctx.actor.externalId)
    await vote.save(null, MASTER)
    await subscribe(ctx.project, row, [ctx.actor.externalId])
  }
  await publishPost(ctx, row, 'feedback.post.created')
  return row
}

/** A pin must name a public, top-level comment on this post. */
async function checkPin(row: ParseObject, commentId: string): Promise<void> {
  const comment = await new (useParse()).Query('FeedbackComment').equalTo('post', row).equalTo('objectId', commentId).first(MASTER)
  if (!comment) badRequest(['pinnedCommentId is not a comment on this post'])
  if (commentVisibility(comment) !== 'public' || comment.get('parentId')) badRequest(['Only a public, top-level comment can be pinned'])
}

/**
 * Whether an update marks the post "edited": its words changed (whoever
 * changed them), or its author re-filed it (type, platform, tags). Triage by
 * the team — statuses, tags on someone else's post — is not an edit.
 */
export function feedbackEdited(values: FeedbackPostValues, current: (key: string) => unknown, byAuthor: boolean): boolean {
  const changed = (key: 'title' | 'body' | 'type' | 'platform' | 'tags') => values[key] !== undefined && JSON.stringify(values[key]) !== JSON.stringify(current(key) ?? (key === 'tags' ? [] : ''))
  return changed('title') || changed('body') || (byAuthor && (changed('type') || changed('platform') || changed('tags')))
}

export async function updateFeedbackPost(ctx: FeedbackContext, row: ParseObject, payload: unknown): Promise<ParseObject> {
  requireWriter(ctx)
  const admin = isFeedbackAdmin(ctx.actor)
  const { canEdit } = feedbackPermissions(ctx.actor, String(row.get('authorExternalId') || ''), ctx.config)
  if (!canEdit) throw createError({ statusCode: 403, statusMessage: 'You cannot edit this post' })
  const { values, errors } = readFeedbackPostInput(payload, ctx.config, { admin, create: false })
  if (errors.length) badRequest(errors)
  if (values.pinnedCommentId) await checkPin(row, values.pinnedCommentId)

  const now = new Date()
  const from = String(row.get('status') || '')
  if (feedbackEdited(values, key => row.get(key), feedbackPermissions(ctx.actor, String(row.get('authorExternalId') || ''), ctx.config).isMine)) row.set('editedAt', now)
  applyValues(row, values)
  if (values.body !== undefined) row.set('refs', parseFeedbackRefs(values.body))
  const to = String(row.get('status') || '')
  const transition = statusTransition(ctx.config, from, to, 'completedAt' in values ? values.completedAt : row.get('completedAt'), now)
  if (transition.changed) {
    row.set('statusChangedAt', now)
    row.set('lastActivityAt', now)
    if (transition.completedAt) row.set('completedAt', transition.completedAt)
  }
  await row.save(null, MASTER)
  await publishPost(ctx, row)
  if (transition.changed) void notifyFeedbackStatusChange(ctx, row, to)
  // A post that has just shipped may get a draft changelog entry (when the project asks for it).
  if (transition.changed && feedbackStatusCategory(ctx.config, from) !== 'done' && feedbackStatusCategory(ctx.config, to) === 'done') {
    await draftChangelogFor(ctx.project, 'feedback', row, ctx.actor.kind === 'agent' ? ctx.actor.agent : undefined).catch(error => console.error('[changelog] could not draft for post', row.id, (error as Error).message))
  }
  return row
}

async function destroyWhere(className: string, constrain: (query: ParseQuery) => ParseQuery): Promise<ParseObject[]> {
  const Parse = useParse()
  const destroyed: ParseObject[] = []
  for (;;) {
    const page = await constrain(new Parse.Query(className)).limit(500).find(MASTER)
    if (!page.length) break
    await Parse.Object.destroyAll(page, MASTER)
    destroyed.push(...page)
    if (page.length < 500) break
  }
  return destroyed
}

/** The post with its votes, comments and followers. */
async function destroyFeedbackPost(row: ParseObject): Promise<void> {
  await destroyWhere('FeedbackVote', q => q.equalTo('post', row))
  await destroyWhere('FeedbackComment', q => q.equalTo('post', row))
  await destroyWhere('FeedbackSubscription', q => q.equalTo('post', row))
  await row.destroy(MASTER)
  await publishFeedbackEvent({ type: 'feedback.post.deleted', projectId: pointerId(row.get('project')), postId: row.id || '' })
}

export async function deleteFeedbackPost(ctx: FeedbackContext, row: ParseObject): Promise<void> {
  requireWriter(ctx)
  if (!feedbackPermissions(ctx.actor, String(row.get('authorExternalId') || ''), ctx.config).canDelete) throw createError({ statusCode: 403, statusMessage: 'You cannot delete this post' })
  await destroyFeedbackPost(row)
}

async function recountVotes(row: ParseObject): Promise<void> {
  row.set('voteCount', await new (useParse()).Query('FeedbackVote').equalTo('post', row).count(MASTER))
}

/** Public comments only: the count must not reveal that team notes exist. */
async function recountComments(row: ParseObject): Promise<void> {
  row.set('commentCount', await new (useParse()).Query('FeedbackComment').equalTo('post', row).notContainedIn('visibility', ['internal', 'hidden']).count(MASTER))
}

/** `want` undefined toggles; true/false sets — so a retried request lands once. */
export async function voteOnFeedbackPost(ctx: FeedbackContext, row: ParseObject, want?: boolean): Promise<boolean> {
  requireWriter(ctx)
  if (ctx.actor.kind !== 'user') throw createError({ statusCode: 403, statusMessage: 'Operators do not vote' })
  if (!votingOpen(feedbackStatusCategory(ctx.config, row.get('status')))) throw createError({ statusCode: 409, statusMessage: 'Voting is closed for this post' })
  requireUnlocked(ctx, row)
  await rateLimit(`sb:rl:fbvote:${ctx.project.id}:${ctx.actor.externalId}`, LIMITS.feedbackVotesPerUser.limit, LIMITS.feedbackVotesPerUser.window)

  const Parse = useParse()
  const existing = await new Parse.Query('FeedbackVote').equalTo('post', row).equalTo('voterId', ctx.actor.externalId).find(MASTER)
  const voted = want === undefined ? !existing.length : want
  if (voted && !existing.length) {
    const vote = new (Parse.Object.extend('FeedbackVote'))()
    vote.set('project', ctx.project)
    vote.set('post', row)
    vote.set('voterId', ctx.actor.externalId)
    await vote.save(null, MASTER)
  } else if (!voted && existing.length) {
    await Parse.Object.destroyAll(existing, MASTER)
  } else {
    return voted
  }
  // Recount rather than increment: a double-click race can never drift the total.
  await recountVotes(row)
  await row.save(null, MASTER)
  await publishPost(ctx, row)
  return voted
}

function readCommentBody(raw: Record<string, unknown>): string {
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  if (!feedbackPlainText(body) && !/<img\b/i.test(body)) badRequest(['A comment needs some text'])
  if (body.length > FEEDBACK_COMMENT_MAX_LENGTH) badRequest([`The comment is longer than ${FEEDBACK_COMMENT_MAX_LENGTH} characters`])
  return body
}

/** Replies stay one level deep: answering a reply files under its parent. */
export function threadParentId(parent: { id: string, parentId: string | null }): string {
  return parent.parentId || parent.id
}

export async function addFeedbackComment(ctx: FeedbackContext, row: ParseObject, payload: unknown): Promise<ParseObject> {
  requireWriter(ctx)
  const admin = isFeedbackAdmin(ctx.actor)
  if (!ctx.config.allowComments && !admin) throw createError({ statusCode: 403, statusMessage: 'Comments are turned off on this board' })
  requireUnlocked(ctx, row)
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const body = readCommentBody(raw)
  const internal = raw.visibility === 'internal'
  if (internal && !admin) throw createError({ statusCode: 403, statusMessage: 'Only the team can write internal notes' })
  if (ctx.actor.kind === 'user') await rateLimit(`sb:rl:fbcomment:${ctx.project.id}:${ctx.actor.externalId}`, LIMITS.feedbackCommentsPerUser.limit, LIMITS.feedbackCommentsPerUser.window)

  const Parse = useParse()
  const sibling = (id: unknown) => (typeof id === 'string' && id ? new Parse.Query('FeedbackComment').equalTo('post', row).equalTo('objectId', id).first(MASTER) : Promise.resolve(undefined))
  const replyTo = await sibling(raw.replyToId)
  const parent = await sibling(raw.parentId) || replyTo
  if ((raw.parentId && !parent) || (raw.replyToId && !replyTo)) badRequest(['That comment is not on this post'])

  const now = new Date()
  const comment = new (Parse.Object.extend('FeedbackComment'))() as ParseObject
  comment.set('project', ctx.project)
  comment.set('post', row)
  comment.set('body', body)
  comment.set('refs', parseFeedbackRefs(body))
  comment.set('postedAt', now)
  if (internal) comment.set('visibility', 'internal')
  if (parent) comment.set('parentId', threadParentId({ id: parent.id || '', parentId: String(parent.get('parentId') || '') || null }))
  if (replyTo) comment.set('replyToId', replyTo.id)
  await stampAuthor(comment, ctx)
  await comment.save(null, MASTER)

  await recountComments(row)
  if (!internal) row.set('lastActivityAt', now)
  await row.save(null, MASTER)
  await publishComment(ctx, row, comment, 'feedback.comment.created')
  if (!internal) {
    if (ctx.actor.kind === 'user') await subscribe(ctx.project, row, [ctx.actor.externalId])
    void notifyFeedbackComment(ctx, row, comment)
  }
  return comment
}

async function loadComment(row: ParseObject, commentId: string): Promise<ParseObject> {
  const comment = await new (useParse()).Query('FeedbackComment').equalTo('post', row).equalTo('objectId', commentId).include('endUser').first(MASTER)
  if (!comment) throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  return comment
}

/** Authors edit their text; admins also move it between public, internal and hidden. */
export async function updateFeedbackComment(ctx: FeedbackContext, row: ParseObject, commentId: string, payload: unknown): Promise<ParseObject> {
  requireWriter(ctx)
  const admin = isFeedbackAdmin(ctx.actor)
  const comment = await loadComment(row, commentId)
  if (!admin && commentVisibility(comment) !== 'public') throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (raw.body !== undefined) {
    if (!feedbackPermissions(ctx.actor, String(comment.get('authorExternalId') || ''), ctx.config).canEdit) throw createError({ statusCode: 403, statusMessage: 'You cannot edit this comment' })
    const body = readCommentBody(raw)
    if (body !== comment.get('body')) {
      comment.set('body', body)
      comment.set('refs', parseFeedbackRefs(body))
      comment.set('editedAt', new Date())
    }
  }
  if (raw.visibility !== undefined) {
    if (!admin) throw createError({ statusCode: 403, statusMessage: 'Only the team can change who sees a comment' })
    const visibility = String(raw.visibility)
    if (!['public', 'internal', 'hidden'].includes(visibility)) badRequest(['visibility must be public, internal or hidden'])
    if (visibility === 'public') comment.unset('visibility')
    else comment.set('visibility', visibility)
    if (visibility !== 'public' && row.get('pinnedCommentId') === comment.id) row.unset('pinnedCommentId')
  }
  await comment.save(null, MASTER)
  await recountComments(row)
  await row.save(null, MASTER)
  await publishComment(ctx, row, comment, 'feedback.comment.updated')
  return comment
}

export async function deleteFeedbackComment(ctx: FeedbackContext, row: ParseObject, commentId: string): Promise<void> {
  requireWriter(ctx)
  const comment = await loadComment(row, commentId)
  if (!feedbackPermissions(ctx.actor, String(comment.get('authorExternalId') || ''), ctx.config).canDelete) throw createError({ statusCode: 403, statusMessage: 'You cannot delete this comment' })
  await comment.destroy(MASTER)
  // Replies stay, and read as top-level once their parent is gone.
  if (row.get('pinnedCommentId') === commentId) row.unset('pinnedCommentId')
  await recountComments(row)
  await row.save(null, MASTER)
  await publishFeedbackEvent({ type: 'feedback.comment.deleted', projectId: ctx.project.id || '', postId: row.id || '', commentId, commentCount: Number(row.get('commentCount') || 0), postHidden: row.get('hidden') === true })
}

/**
 * Toggle (or set, with `want`) one reaction on a post or one of its comments.
 * Stored as `"key:actor"` strings changed with $addToSet/$pull, so two people
 * reacting at once never overwrite each other.
 * ponytail: an array on the row — fine for hundreds per row; a FeedbackReaction class if it ever outgrows that.
 */
export async function reactToFeedback(ctx: FeedbackContext, row: ParseObject, target: ParseObject, key: unknown, want?: boolean): Promise<ParseObject> {
  requireWriter(ctx)
  if (!isFeedbackReaction(key)) badRequest([`Unknown reaction: ${String(key)}`])
  requireUnlocked(ctx, row)
  if (target !== row && commentVisibility(target) !== 'public') throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  if (ctx.actor.kind === 'user') await rateLimit(`sb:rl:fbreact:${ctx.project.id}:${ctx.actor.externalId}`, LIMITS.feedbackReactionsPerUser.limit, LIMITS.feedbackReactionsPerUser.window)

  const entry = feedbackReactionEntry(key, feedbackActorId(ctx.actor))
  const has = stringList(target.get('reactions')).includes(entry)
  const on = want === undefined ? !has : want
  if (on === has) return target
  if (on) target.addUnique('reactions', entry)
  else target.remove('reactions', entry)
  await target.save(null, MASTER)
  const fresh = await reload(target)
  if (target === row) await publishPost(ctx, fresh)
  else await publishComment(ctx, row, fresh, 'feedback.comment.updated')
  return fresh
}

/** Follow, unfollow, mute or mark read. Returns the viewer's new state. */
export async function setFeedbackSubscription(ctx: FeedbackContext, row: ParseObject, payload: unknown): Promise<{ subscribed: boolean, muted: boolean, unread: boolean }> {
  requireWriter(ctx)
  if (ctx.actor.kind !== 'user') throw createError({ statusCode: 403, statusMessage: 'Only signed-in users follow posts' })
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const Parse = useParse()
  let sub = await new Parse.Query('FeedbackSubscription').equalTo('post', row).equalTo('subscriberId', ctx.actor.externalId).first(MASTER)

  if (raw.subscribed === false) {
    if (sub) await sub.destroy(MASTER)
    return { subscribed: false, muted: false, unread: false }
  }
  if (!sub && (raw.subscribed === true || raw.muted !== undefined)) {
    await subscribe(ctx.project, row, [ctx.actor.externalId])
    sub = await new Parse.Query('FeedbackSubscription').equalTo('post', row).equalTo('subscriberId', ctx.actor.externalId).first(MASTER)
  }
  if (!sub) return { subscribed: false, muted: false, unread: false }
  if (typeof raw.muted === 'boolean') sub.set('muted', raw.muted)
  if (raw.read === true) sub.set('lastReadAt', new Date())
  if (sub.dirty()) await sub.save(null, MASTER)
  return {
    subscribed: true,
    muted: sub.get('muted') === true,
    unread: feedbackUnread(row.get('lastActivityAt') as Date | undefined, { lastReadAt: sub.get('lastReadAt') as Date | undefined, createdAt: sub.createdAt })
  }
}

/**
 * Merge a duplicate into the post it repeats: votes move (a voter counts once),
 * followers are copied, and the duplicate is locked in a closed status. `into:
 * null` undoes the link (moved votes stay where they went).
 */
export async function mergeFeedbackDuplicate(ctx: FeedbackContext, row: ParseObject, payload: unknown): Promise<{ post: ParseObject, into: ParseObject | null }> {
  requireAdmin(ctx)
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const Parse = useParse()
  if (raw.into === null) {
    row.unset('duplicateOf')
    await row.save(null, MASTER)
    await publishPost(ctx, row)
    return { post: row, into: null }
  }
  const into = await findFeedbackPost(ctx.project, String(raw.into ?? ''))
  if (!into) throw createError({ statusCode: 404, statusMessage: 'The post to merge into was not found' })
  if (into.id === row.id) badRequest(['A post cannot be merged into itself'])
  if (into.get('duplicateOf')) badRequest(['That post is itself a duplicate; merge into the one it points at'])
  let status = row.get('status') as string
  if (raw.status !== undefined) {
    const key = normalizeFeedbackKey(raw.status)
    if (!feedbackStatusDefinition(ctx.config, key)) badRequest([`Unknown status: ${key}`])
    status = key
  } else {
    status = ctx.config.statuses.find(s => s.category === 'closed')?.key || status
  }

  const have = new Set<string>()
  await eachBatch(() => new Parse.Query('FeedbackVote').equalTo('post', into), (kept) => {
    for (const v of kept) have.add(String(v.get('voterId')))
  }, { keys: ['voterId'] })
  // A batch at a time: its votes land on the other post, then leave this one.
  await eachBatch(() => new Parse.Query('FeedbackVote').equalTo('post', row), async (moving) => {
    const fresh = moving.filter(v => !have.has(String(v.get('voterId')))).map((v) => {
      const vote = new (Parse.Object.extend('FeedbackVote'))()
      vote.set('project', ctx.project)
      vote.set('post', into)
      vote.set('voterId', v.get('voterId'))
      return vote
    })
    if (fresh.length) await Parse.Object.saveAll(fresh, MASTER)
    await Parse.Object.destroyAll(moving, MASTER)
  })
  await eachBatch(() => new Parse.Query('FeedbackSubscription').equalTo('post', row), async (followers) => {
    await subscribe(ctx.project, into, followers.map(sub => String(sub.get('subscriberId'))))
  }, { keys: ['subscriberId'] })

  const now = new Date()
  const from = String(row.get('status') || '')
  row.set('duplicateOf', into)
  row.set('locked', true)
  row.set('status', status)
  const transition = statusTransition(ctx.config, from, status, row.get('completedAt') as Date | undefined, now)
  if (transition.changed) {
    row.set('statusChangedAt', now)
    row.set('lastActivityAt', now)
    if (transition.completedAt) row.set('completedAt', transition.completedAt)
  }
  await recountVotes(row)
  await recountVotes(into)
  into.set('lastActivityAt', now)
  await Parse.Object.saveAll([row, into], MASTER)
  await publishPost(ctx, row)
  await publishPost(ctx, into)
  if (transition.changed) void notifyFeedbackStatusChange(ctx, row, status)
  return { post: row, into }
}

// ---- people -----------------------------------------------------------------

/** Everyone in a thread: its author, public commenters and followers, with who wrote as the team. */
async function threadPeople(row: ParseObject): Promise<{ ids: string[], team: Set<string> }> {
  const Parse = useParse()
  const followers: string[] = []
  const [comments] = await Promise.all([
    new Parse.Query('FeedbackComment').equalTo('post', row).notContainedIn('visibility', ['internal', 'hidden']).select('authorExternalId', 'authorIsTeam').limit(1000).find(MASTER),
    eachBatch(() => new Parse.Query('FeedbackSubscription').equalTo('post', row), (subs) => {
      followers.push(...subs.map(sub => String(sub.get('subscriberId') || '')))
    }, { keys: ['subscriberId'] })
  ])
  const team = new Set<string>()
  const ids = [String(row.get('authorExternalId') || '')]
  if (row.get('authorIsTeam') === true) team.add(ids[0]!)
  for (const c of comments) {
    const id = String(c.get('authorExternalId') || '')
    ids.push(id)
    if (c.get('authorIsTeam') === true) team.add(id)
  }
  ids.push(...followers)
  return { ids: [...new Set(ids.filter(Boolean))], team }
}

/** This project's people with a handle, among host user ids (a thread's, which can be more than one read returns). */
async function peopleWithHandles(project: ParseObject, ids: string[]): Promise<ParseObject[]> {
  const people: ParseObject[] = []
  await eachBatch(() => new (useParse()).Query('EndUser').equalTo('project', project).containedIn('externalId', ids).exists('username'), (rows) => { people.push(...rows) })
  return people
}

/**
 * Who `@` can complete in this thread: handles, names and avatars only — never
 * an id or an email. Boards that hide names only offer the team.
 */
export async function listFeedbackParticipants(ctx: FeedbackContext, row: ParseObject, q: unknown): Promise<FeedbackParticipant[]> {
  requireWriter(ctx)
  const { ids, team } = await threadPeople(row)
  if (!ids.length) return []
  const showAll = isFeedbackAdmin(ctx.actor) || ctx.config.showAuthorNames
  const people = await peopleWithHandles(ctx.project, ids)
  const needle = String(q ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 40)
  return people
    .map(person => ({
      handle: String(person.get('username') || ''),
      name: String(person.get('name') || ''),
      avatarUrl: String(person.get('avatarUrl') || ''),
      isTeam: team.has(String(person.get('externalId')))
    }))
    .filter(p => p.handle && (showAll || p.isTeam) && (!needle || p.handle.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.isTeam) - Number(a.isTeam) || a.handle.localeCompare(b.handle))
    .slice(0, 8)
}

export async function getFeedbackPreferences(ctx: FeedbackContext): Promise<{ emails: boolean }> {
  if (ctx.actor.kind !== 'user') throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })
  const endUser = await findEndUser(ctx.project, ctx.actor.externalId)
  return { emails: endUser?.get('feedbackEmails') !== false }
}

export async function setFeedbackPreferences(ctx: FeedbackContext, payload: unknown): Promise<{ emails: boolean }> {
  if (ctx.actor.kind !== 'user') throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (typeof raw.emails !== 'boolean') badRequest(['emails must be true or false'])
  const endUser = await ensureEndUser(ctx.project, ctx.actor.claims)
  endUser.set('feedbackEmails', raw.emails)
  await endUser.save(null, MASTER)
  return { emails: raw.emails }
}

// ---- notifications ----------------------------------------------------------

// Advisory, like chat email: the write has landed before any mail is tried,
// and one recipient hears about one post at most every few minutes.
const FEEDBACK_EMAIL_THROTTLE_SECONDS = 10 * 60

async function feedbackEmailThrottled(postId: string, externalId: string, kind: string): Promise<boolean> {
  try {
    const ok = await useRedis().set(`sb:fbmail:${kind}:${postId}:${externalId}`, '1', 'EX', FEEDBACK_EMAIL_THROTTLE_SECONDS, 'NX')
    return ok !== 'OK'
  } catch {
    return false
  }
}

async function emailEndUsers(ctx: FeedbackContext, row: ParseObject, externalIds: string[], kind: string, mail: { subject: string, senderName: string, body: string }): Promise<void> {
  if (!ctx.config.emailNotifications || !externalIds.length) return
  const appName = String(ctx.project.get('name') || 'Support')
  const sender = projectEmailSender(ctx.project, { fromName: `${appName} feedback` })
  if (!isMailerConfigured(sender)) return
  const Parse = useParse()
  const ctaUrl = feedbackPostUrl(ctx.config, String(ctx.project.get('siteUrl') || ''), { id: row.id || '', number: numberOf(row), title: String(row.get('title') || '') })
  const batchId = newEmailBatchId()
  const poweredBy = await poweredByFor(ctx.project)
  // A popular post's followers are mailed a batch at a time.
  await eachBatch(() => new Parse.Query('EndUser').equalTo('project', ctx.project).containedIn('externalId', externalIds).notEqualTo('feedbackEmails', false), async (users) => {
    const mails: OutgoingEmail[] = []
    for (const user of users) {
      const email = String(user.get('email') || '').trim()
      if (!isProbablyEmail(email)) continue
      if (await feedbackEmailThrottled(row.id || '', String(user.get('externalId')), kind)) continue
      const name = String(user.get('name') || '')
      const { subject, html, text } = renderMessageEmail({ appName, senderName: mail.senderName, recipientName: name, subject: mail.subject, body: mail.body, ctaUrl, ctaLabel: 'View the post', attachmentUrls: [], poweredBy })
      mails.push({ project: ctx.project, to: { email, name }, subject, html, text, sender, log: { source: 'feedback', kind: 'message', templateName: `Feedback: ${kind}`, batchId, actor: SYSTEM_EMAIL_ACTOR } })
    }
    if (!mails.length) return
    try {
      await deliverEmails(mails)
    } catch (error) {
      console.error('[feedback] email failed:', (error as Error).message)
    }
  })
}

function actorExternalId(actor: FeedbackActor): string {
  return actor.kind === 'user' ? actor.externalId : ''
}

/**
 * Who hears about a post: its unmuted followers, plus the author when they
 * have no subscription row at all (posts from before subscriptions existed).
 * Never the person who acted, nor anyone in `exclude`.
 */
export function feedbackRecipients(input: { subscribers: { id: string, muted: boolean }[], author: string, actor: string, exclude?: string[] }): string[] {
  const out = new Set(input.subscribers.filter(s => !s.muted).map(s => s.id))
  if (input.author && !input.subscribers.some(s => s.id === input.author)) out.add(input.author)
  out.delete('')
  out.delete(input.actor)
  for (const id of input.exclude || []) out.delete(id)
  return [...out]
}

async function postRecipients(ctx: FeedbackContext, row: ParseObject, exclude: string[] = []): Promise<string[]> {
  const subscribers: { id: string, muted: boolean }[] = []
  await eachBatch(() => new (useParse()).Query('FeedbackSubscription').equalTo('post', row), (subs) => {
    subscribers.push(...subs.map(sub => ({ id: String(sub.get('subscriberId') || ''), muted: sub.get('muted') === true })))
  }, { keys: ['subscriberId', 'muted'] })
  return feedbackRecipients({
    subscribers,
    author: String(row.get('authorExternalId') || ''),
    actor: actorExternalId(ctx.actor),
    exclude
  })
}

export async function notifyFeedbackStatusChange(ctx: FeedbackContext, row: ParseObject, status: string): Promise<void> {
  try {
    const definition = feedbackStatusDefinition(ctx.config, status)
    if (!definition?.notify || row.get('hidden') === true) return
    const title = String(row.get('title') || '')
    await emailEndUsers(ctx, row, await postRecipients(ctx, row), `status-${status}`, {
      subject: `“${title}” is now ${definition.label.toLowerCase()}`,
      senderName: String(ctx.project.get('fromName') || ctx.project.get('name') || 'The team'),
      body: `“${title}” on the ${ctx.project.get('name') || ''} feedback board moved to ${definition.label}.\n\nYou're getting this because you follow it.`
    })
  } catch (error) {
    console.error('[feedback] status notification failed:', (error as Error).message)
  }
}

/**
 * A new public comment: people it `@mentions` (among the thread's participants)
 * get a mention email and are subscribed; every other follower gets the comment.
 */
export async function notifyFeedbackComment(ctx: FeedbackContext, row: ParseObject, comment: ParseObject): Promise<void> {
  try {
    const actor = actorExternalId(ctx.actor)
    const handles = parseFeedbackMentions(String(comment.get('body') || ''))
    let mentioned: string[] = []
    if (handles.length) {
      const { ids } = await threadPeople(row)
      const people = await peopleWithHandles(ctx.project, ids)
      mentioned = people.filter(p => handles.includes(String(p.get('username')).toLowerCase())).map(p => String(p.get('externalId'))).filter(id => id && id !== actor)
      await subscribe(ctx.project, row, mentioned)
    }
    if (row.get('hidden') === true) return
    const title = String(row.get('title') || '')
    const who = String(comment.get('authorName') || 'Someone')
    const signed = `${who}${comment.get('authorIsTeam') ? ` (${ctx.project.get('name') || 'team'})` : ''}`
    const excerpt = feedbackPlainText(comment.get('body'), 2000)
    await emailEndUsers(ctx, row, mentioned, 'mention', {
      subject: `${who} mentioned you on “${title}”`,
      senderName: who,
      body: `${signed} mentioned you on “${title}”:\n\n${excerpt}`
    })
    await emailEndUsers(ctx, row, await postRecipients(ctx, row, mentioned), 'comment', {
      subject: `New comment on “${title}”`,
      senderName: who,
      body: `${signed} commented on “${title}”:\n\n${excerpt}`
    })
  } catch (error) {
    console.error('[feedback] comment notification failed:', (error as Error).message)
  }
}

// ---- import -----------------------------------------------------------------

export type FeedbackImportPerson = { externalId?: unknown, name?: unknown, email?: unknown, username?: unknown, avatarUrl?: unknown, emailOptOut?: unknown } | null | undefined

type ImportedAuthor = { externalId: string, name: string, endUser: ParseObject | null }

async function importPerson(project: ParseObject, person: FeedbackImportPerson): Promise<ImportedAuthor> {
  const raw = (person && typeof person === 'object' ? person : {}) as Record<string, unknown>
  const externalId = typeof raw.externalId === 'string' ? raw.externalId.trim().slice(0, 200) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : ''
  const email = normalizeEmail(raw.email)
  const username = normalizeHandle(raw.username)
  const avatarUrl = safeAvatarUrl(raw.avatarUrl)
  if (!externalId || (!name && !email && !username)) return { externalId, name, endUser: null }
  // An EndUser row (no lastSeenAt: importing is not the user showing up) so
  // the person can be emailed about their post later.
  const Parse = useParse()
  let endUser = await findEndUser(project, externalId)
  if (!endUser) {
    endUser = new (Parse.Object.extend('EndUser'))() as ParseObject
    endUser.set('project', project)
    endUser.set('externalId', externalId)
    endUser.set('origin', { type: 'feedback', id: '', at: new Date().toISOString() })
  }
  let dirty = endUser.isNew()
  // What the user's own token said wins over history: only fill blanks.
  for (const [key, value] of [['name', name], ['email', email], ['username', username], ['avatarUrl', avatarUrl]] as const) {
    if (value && !endUser.get(key)) { endUser.set(key, value); dirty = true }
  }
  // An opt-out carries over; an import never opts anyone back in.
  if (raw.emailOptOut === true && endUser.get('feedbackEmails') !== false) { endUser.set('feedbackEmails', false); dirty = true }
  if (dirty) await endUser.save(null, MASTER)
  return { externalId, name, endUser }
}

function importDate(value: unknown, fallback: Date): Date {
  if (value === undefined || value === null || value === '') return fallback
  const date = new Date(typeof value === 'object' && value && 'iso' in value ? String((value as { iso: unknown }).iso) : String(value))
  return Number.isNaN(date.getTime()) ? fallback : date
}

/** `{ "+1": ["user_1"], heart: [...] }` → stored entries; unknown keys dropped. */
export function importReactions(value: unknown): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = new Set<string>()
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!isFeedbackReaction(key) || !Array.isArray(ids)) continue
    for (const id of ids.slice(0, 5000)) {
      const actor = String(id ?? '').trim().slice(0, 200)
      if (actor) out.add(feedbackReactionEntry(key, actor))
    }
  }
  return [...out]
}

function importString(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function importComments(project: ParseObject, row: ParseObject, items: unknown[], postedAt: Date): Promise<Date> {
  const Parse = useParse()
  let lastActivity = postedAt
  const links: { comment: ParseObject, parent: string, replyTo: string }[] = []
  for (const rawComment of items.slice(0, 1000)) {
    const input = (rawComment && typeof rawComment === 'object' ? rawComment : {}) as Record<string, unknown>
    const body = typeof input.body === 'string' ? input.body.trim().slice(0, FEEDBACK_COMMENT_MAX_LENGTH) : ''
    if (!body) continue
    const externalId = importString(input.externalId)
    let comment = externalId ? await new Parse.Query('FeedbackComment').equalTo('post', row).equalTo('externalId', externalId).first(MASTER) : undefined
    if (!comment) {
      comment = new (Parse.Object.extend('FeedbackComment'))() as ParseObject
      comment.set('project', project)
      comment.set('post', row)
      if (externalId) comment.set('externalId', externalId)
    }
    const commenter = await importPerson(project, input.author as FeedbackImportPerson)
    const commentedAt = importDate(input.createdAt, postedAt)
    comment.set('body', body)
    comment.set('refs', parseFeedbackRefs(body))
    comment.set('authorExternalId', commenter.externalId)
    comment.set('authorName', commenter.name)
    comment.set('authorIsTeam', input.isTeam === true)
    if (commenter.endUser) comment.set('endUser', commenter.endUser)
    comment.set('postedAt', commentedAt)
    if (input.visibility === 'internal' || input.visibility === 'hidden') comment.set('visibility', input.visibility)
    else comment.unset('visibility')
    const editedAt = input.editedAt ? importDate(input.editedAt, commentedAt) : null
    if (editedAt) comment.set('editedAt', editedAt)
    else comment.unset('editedAt')
    const reactions = importReactions(input.reactions)
    if (reactions) comment.set('reactions', reactions)
    await comment.save(null, MASTER)
    links.push({ comment, parent: importString(input.parentExternalId), replyTo: importString(input.replyToExternalId) })
    if (commentedAt > lastActivity && comment.get('visibility') === undefined) lastActivity = commentedAt
  }

  // Second pass: threading by external id, once every comment exists.
  if (links.some(l => l.parent || l.replyTo)) {
    const byExternalId = new Map<string, ParseObject>()
    await eachBatch(() => new Parse.Query('FeedbackComment').equalTo('post', row).exists('externalId'), (all) => {
      for (const c of all) byExternalId.set(String(c.get('externalId')), c)
    }, { keys: ['externalId', 'parentId'] })
    const changed: ParseObject[] = []
    for (const { comment, parent, replyTo } of links) {
      const parentRow = byExternalId.get(parent) || byExternalId.get(replyTo)
      const replyRow = byExternalId.get(replyTo)
      const parentId = parentRow ? threadParentId({ id: parentRow.id || '', parentId: String(parentRow.get('parentId') || '') || null }) : ''
      if (parentId && parentId !== comment.id) comment.set('parentId', parentId)
      else comment.unset('parentId')
      if (replyRow && replyRow.id !== comment.id) comment.set('replyToId', replyRow.id)
      else comment.unset('replyToId')
      if (comment.dirty()) changed.push(comment)
    }
    if (changed.length) await Parse.Object.saveAll(changed, MASTER)
  }
  return lastActivity
}

/**
 * Upsert one post with its full history: votes and followers are synced to
 * exactly the given ids, comments upserted by their `externalId` (threading,
 * pins and duplicates resolved by external id too). Re-running an import with
 * the same `externalId`s converges instead of duplicating.
 */
export async function importFeedbackPost(project: ParseObject, config: FeedbackBoardConfig, item: Record<string, unknown>): Promise<{ id: string, created: boolean }> {
  const Parse = useParse()
  const { values, errors } = readFeedbackPostInput(item, config, { admin: true, create: true, import: true })
  // Pins and duplicates come in by external id below.
  delete values.pinnedCommentId
  if (errors.length) throw new Error(errors.join('; '))
  const now = new Date()

  let row = values.externalId
    ? await new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('externalId', values.externalId).first(MASTER)
    : undefined
  const created = !row
  if (values.number) {
    const holder = await new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('number', values.number).first(MASTER)
    if (holder && holder.id !== row?.id) throw new Error(`Number ${values.number} already belongs to another post`)
  }
  if (!row) {
    row = new (Parse.Object.extend('FeedbackPost'))() as ParseObject
    row.set('project', project)
    row.set('body', '')
    row.set('type', '')
    row.set('platform', '')
    row.set('tags', [])
    row.set('status', defaultFeedbackStatus(config).key)
    row.set('hidden', false)
    row.set('featured', false)
    row.set('locked', false)
    row.set('showOnChangelog', false)
    row.set('voteCount', 0)
    row.set('commentCount', 0)
  }
  applyValues(row, values)
  if (!row.get('number')) row.set('number', await allocateProjectNumber(project, 'feedbackPostSeq', 'FeedbackPost'))
  row.set('refs', parseFeedbackRefs(String(row.get('body') || '')))
  const reactions = importReactions(item.reactions)
  if (reactions) row.set('reactions', reactions)

  const author = await importPerson(project, item.author as FeedbackImportPerson)
  row.set('authorExternalId', author.externalId)
  row.set('authorName', author.name)
  row.set('authorIsTeam', item.isTeam === true)
  if (author.endUser) row.set('endUser', author.endUser)
  else row.unset('endUser')

  const postedAt = importDate(item.createdAt, (row.get('postedAt') as Date | undefined) || now)
  row.set('postedAt', postedAt)
  if (!row.get('statusChangedAt')) row.set('statusChangedAt', postedAt)
  if (!values.completedAt && !row.get('completedAt') && feedbackStatusCategory(config, row.get('status')) === 'done') row.set('completedAt', postedAt)
  await row.save(null, MASTER)

  if (Array.isArray(item.votes)) {
    const wanted = new Set(item.votes.map(v => String(v ?? '').trim().slice(0, 200)).filter(Boolean).slice(0, 20000))
    const have = new Set<string>()
    await eachBatch(() => new Parse.Query('FeedbackVote').equalTo('post', row), async (existing) => {
      for (const v of existing) have.add(String(v.get('voterId')))
      const stale = existing.filter(v => !wanted.has(String(v.get('voterId'))))
      if (stale.length) await Parse.Object.destroyAll(stale, MASTER)
    })
    const fresh = [...wanted].filter(id => !have.has(id)).map((voterId) => {
      const vote = new (Parse.Object.extend('FeedbackVote'))()
      vote.set('project', project)
      vote.set('post', row)
      vote.set('voterId', voterId)
      return vote
    })
    if (fresh.length) await Parse.Object.saveAll(fresh, MASTER)
    await recountVotes(row)
  }

  let lastActivity = postedAt
  if (Array.isArray(item.comments)) {
    lastActivity = await importComments(project, row, item.comments, postedAt)
    await recountComments(row)
  }

  if (Array.isArray(item.subscriptions)) {
    // Exactly these followers, with their mute and read state.
    const wanted = new Map<string, Record<string, unknown>>()
    for (const raw of item.subscriptions.slice(0, 20000)) {
      const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const person = await importPerson(project, input as FeedbackImportPerson)
      if (person.externalId) wanted.set(person.externalId, input)
    }
    const byId = new Map<string, ParseObject>()
    await eachBatch(() => new Parse.Query('FeedbackSubscription').equalTo('post', row), async (existing) => {
      for (const sub of existing) byId.set(String(sub.get('subscriberId')), sub)
      const stale = existing.filter(sub => !wanted.has(String(sub.get('subscriberId'))))
      if (stale.length) await Parse.Object.destroyAll(stale, MASTER)
    })
    const save: ParseObject[] = []
    for (const [id, input] of wanted) {
      let sub = byId.get(id)
      if (!sub) {
        sub = new (Parse.Object.extend('FeedbackSubscription'))() as ParseObject
        sub.set('project', project)
        sub.set('post', row)
        sub.set('subscriberId', id)
      }
      sub.set('muted', input.muted === true)
      sub.set('lastReadAt', importDate(input.lastReadAt, postedAt))
      if (sub.dirty()) save.push(sub)
    }
    if (save.length) await Parse.Object.saveAll(save, MASTER)
  } else {
    // No list given: whoever wrote in the thread follows it, as they would have live.
    const commenters = await new Parse.Query('FeedbackComment').equalTo('post', row).notContainedIn('visibility', ['internal', 'hidden']).select('authorExternalId').limit(1000).find(MASTER)
    await subscribe(project, row, [author.externalId, ...commenters.map(c => String(c.get('authorExternalId') || ''))])
  }

  const pinned = importString(item.pinnedCommentExternalId)
  const pin = pinned ? await new Parse.Query('FeedbackComment').equalTo('post', row).equalTo('externalId', pinned).first(MASTER) : undefined
  if (pin) row.set('pinnedCommentId', pin.id)
  else row.unset('pinnedCommentId')

  row.set('lastActivityAt', lastActivity)
  const duplicateOf = importString(item.duplicateOfExternalId)
  let missingDuplicate = false
  if (duplicateOf) {
    const target = await new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('externalId', duplicateOf).first(MASTER)
    if (target && target.id !== row.id) row.set('duplicateOf', target)
    else missingDuplicate = true
  } else {
    row.unset('duplicateOf')
  }
  await row.save(null, MASTER)
  const ctx: FeedbackContext = { project, config, actor: { kind: 'anonymous' } }
  await publishPost(ctx, await reload(row), created ? 'feedback.post.created' : 'feedback.post.updated')
  // Everything else landed; re-running once the target exists links it.
  if (missingDuplicate) throw new Error(`duplicateOfExternalId ${duplicateOf} is not imported yet; import it, then re-run this post`)
  return { id: row.id || '', created }
}

// ---- erase ------------------------------------------------------------------

/**
 * Remove everything one host user left in a project: their posts (with the
 * votes, comments and followers on them), their comments, votes, reactions and
 * follows elsewhere, their support conversations, the mail sent to them and
 * the contact itself. For "delete my account" flows on the host. Pass the
 * EndUser row for a contact that has no externalId (a newsletter sign-up).
 */
export async function eraseEndUserData(project: ParseObject, who: string | ParseObject): Promise<Record<string, number>> {
  const Parse = useParse()
  const externalId = typeof who === 'string' ? who : String(who.get('externalId') || '')
  const counts = { posts: 0, comments: 0, votes: 0, reactions: 0, subscriptions: 0, changelogSubscriptions: 0, conversations: 0, messages: 0, emailLogs: 0, enrollments: 0, files: 0, endUsers: 0 }
  if (externalId) await eraseFeedbackData(project, externalId, counts)

  const endUser = typeof who === 'string' ? await findEndUser(project, externalId) : who
  // Changelog subscriptions are keyed by address as often as by user id: one made
  // signed out (or by a newsletter-only contact) carries no id at all.
  counts.changelogSubscriptions = await eraseChangelogSubscriptions(project, {
    externalId,
    emails: endUser ? [String(endUser.get('email') || ''), String(endUser.get('pendingEmail') || '')] : []
  })
  if (endUser) {
    // A page at a time until none are left: an erasure must not stop at the first thousand.
    for (;;) {
      const conversations = await new Parse.Query('Conversation').equalTo('endUser', endUser).limit(500).find(MASTER)
      for (const conversation of conversations) {
        counts.messages += (await destroyWhere('Message', q => q.equalTo('conversation', conversation))).length
        await conversation.destroy(MASTER)
        await removeConversationFromSearch(conversation.id || '')
      }
      counts.conversations += conversations.length
      if (conversations.length < 500) break
    }
    const email = String(endUser.get('email') || '')
    if (email) {
      // An opt-out outlives the erasure: the address alone stays, so a later
      // import or sync can never mail them again.
      if (endUser.get('subscription') === 'unsubscribed') await addEmailSuppressions(project, [{ email, reason: 'unsubscribe', detail: 'Unsubscribed, then erased', source: 'api' }])
      counts.emailLogs = (await destroyWhere('EmailLog', q => q.equalTo('project', project).equalTo('to', email))).length
    }
    // An email-only user who never verified: the code mails went to the address they typed.
    const pending = String(endUser.get('pendingEmail') || '')
    if (pending) counts.emailLogs += (await destroyWhere('EmailLog', q => q.equalTo('project', project).equalTo('to', pending))).length
    await revokeEndUserSessions(endUser)
    counts.enrollments = (await destroyWhere('SequenceEnrollment', q => q.equalTo('contact', endUser)).catch(() => [])).length
    // Files they sent through a lead form: the rows and the stored objects.
    counts.files = await eraseLeadFiles(project, endUser)
    // Queued webhook events about them carry their address; they go too.
    await destroyWhere('WebhookDelivery', q => q.equalTo('project', project).equalTo('status', 'pending').equalTo('payload.data.contact.id', endUser.id)).catch(() => [])
    await endUser.destroy(MASTER)
    await removeEndUserFromSearch(endUser.id || '')
    counts.endUsers = 1
  }
  return counts
}

async function eraseFeedbackData(project: ParseObject, externalId: string, counts: Record<string, number>): Promise<void> {
  const Parse = useParse()

  for (;;) {
    const posts = await new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('authorExternalId', externalId).limit(500).find(MASTER)
    for (const post of posts) await destroyFeedbackPost(post)
    counts.posts = (counts.posts || 0) + posts.length
    if (posts.length < 500) break
  }

  const touched = new Map<string, ParseObject>()
  const comments = await destroyWhere('FeedbackComment', q => q.equalTo('project', project).equalTo('authorExternalId', externalId).include('post'))
  const votes = await destroyWhere('FeedbackVote', q => q.equalTo('project', project).equalTo('voterId', externalId).include('post'))
  for (const row of [...comments, ...votes]) {
    const post = row.get('post') as ParseObject | undefined
    if (post?.id) touched.set(post.id, post)
  }
  counts.comments = comments.length
  counts.votes = votes.length
  counts.subscriptions = (await destroyWhere('FeedbackSubscription', q => q.equalTo('project', project).equalTo('subscriberId', externalId))).length

  // Reactions live on the rows they react to; the key set is fixed, so every
  // entry this user could own is known up front.
  const entries = FEEDBACK_REACTIONS.map(key => feedbackReactionEntry(key, externalId))
  let reactions = 0
  for (const className of ['FeedbackPost', 'FeedbackComment']) {
    await eachBatch(() => new Parse.Query(className).equalTo('project', project).containedIn('reactions', entries), async (rows) => {
      for (const row of rows) {
        const kept = stringList(row.get('reactions')).filter(entry => !entries.includes(entry))
        reactions += stringList(row.get('reactions')).length - kept.length
        row.set('reactions', kept)
      }
      await Parse.Object.saveAll(rows, MASTER)
    })
  }
  counts.reactions = reactions

  const ctx: FeedbackContext = { project, config: getFeedbackConfig(project), actor: { kind: 'anonymous' } }
  for (const post of touched.values()) {
    await recountVotes(post)
    await recountComments(post)
    if (comments.some(c => c.id === post.get('pinnedCommentId'))) post.unset('pinnedCommentId')
    await post.save(null, MASTER)
    await publishPost(ctx, post)
  }

  counts.changelogComments = await eraseChangelogComments(project, externalId)
  const blog = await eraseBlogData(project, externalId)
  counts.blogComments = blog.comments
  counts.blogReactions = blog.reactions
  // The EndUser row and its conversations are eraseEndUserData's: removing
  // them here would hide the row from it, and with it the mail log,
  // enrollments and opt-out suppression it clears.
}

// ---- responses --------------------------------------------------------------

/** One post as this viewer sees it (admins also get the author's email). */
export async function feedbackPostForViewer(ctx: FeedbackContext, row: ParseObject): Promise<FeedbackPost> {
  const endUser = row.get('endUser') as ParseObject | undefined
  if (endUser && endUser.get('externalId') === undefined) await endUser.fetch(MASTER).catch(() => {})
  const duplicateOf = row.get('duplicateOf') as ParseObject | undefined
  if (duplicateOf && duplicateOf.get('title') === undefined) await duplicateOf.fetch(MASTER).catch(() => {})
  return serializeFeedbackPost(row, ctx, await feedbackViewerState(ctx, [row.id || '']))
}

/** Map one live event to what this viewer may see; hidden posts and team notes vanish for non-admins. */
export function feedbackEventForViewer(event: FeedbackEvent, admin: boolean): FeedbackEvent | null {
  if (admin) return event
  if ((event.type === 'feedback.post.created' || event.type === 'feedback.post.updated') && event.post.hidden) {
    return event.type === 'feedback.post.created' ? null : { type: 'feedback.post.deleted', projectId: event.projectId, postId: event.postId }
  }
  if (event.type === 'feedback.post.created' || event.type === 'feedback.post.updated') return { ...event, post: withoutChangelogDraft(event.post) }
  if (event.type.startsWith('feedback.comment.') && 'postHidden' in event && event.postHidden) return null
  if ((event.type === 'feedback.comment.created' || event.type === 'feedback.comment.updated') && event.comment.visibility !== 'public') {
    return event.type === 'feedback.comment.created' ? null : { type: 'feedback.comment.deleted', projectId: event.projectId, postId: event.postId, commentId: event.comment.id, commentCount: event.commentCount, postHidden: event.postHidden }
  }
  return event
}
