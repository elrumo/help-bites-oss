import { createError } from 'h3'
import {
  BLOG_COMMENTS_PAGE_MAX,
  BLOG_COMMENT_STATUSES,
  BLOG_REACTIONS,
  blogReactionEntry,
  readBlogCommentInput,
  type BlogComment,
  type BlogCommentPage,
  type BlogCommentStatus,
  type BlogCommentWithPost
} from '#shared/blog'
import { changelogCommentText, checkChangelogComment } from './changelogRender'

// Comments on blog posts: the sibling of blog.ts, as changelogComments.ts is
// of changelog.ts. Posts are written by the team; comments by anybody signed
// in, so this side has the tighter sanitiser (the changelog's comment
// renderer: no raw HTML, images or headings), a rate limit, a duplicate guard
// and moderation. The team answers from the panel or the app: an operator's
// comment is marked as the team's. Replies are one level deep.

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

type Live = { name: string, avatar: string }

/** Current names and avatars of a page's authors (a renamed account shows on old comments); stored copies are the fallback. */
async function liveAuthors(project: ParseObject, externalIds: string[]): Promise<Map<string, Live>> {
  const ids = [...new Set(externalIds.filter(id => id && !id.startsWith('agent:')))]
  if (!ids.length) return new Map()
  const rows = await new (useParse()).Query('EndUser').equalTo('project', project).containedIn('externalId', ids).select('externalId', 'name', 'username', 'avatarUrl').limit(ids.length).find(MASTER)
  return new Map(rows.map(row => [String(row.get('externalId')), { name: String(row.get('name') || row.get('username') || ''), avatar: String(row.get('avatarUrl') || '') }]))
}

function statusOf(row: ParseObject): BlogCommentStatus {
  return (BLOG_COMMENT_STATUSES as readonly string[]).includes(String(row.get('status'))) ? row.get('status') as BlogCommentStatus : 'visible'
}

export function serializeBlogComment(row: ParseObject, viewerId: string, live?: Live): BlogComment {
  const authorId = String(row.get('authorExternalId') || '')
  return {
    id: row.id || '',
    postId: pointerId(row.get('post')),
    parentId: String(row.get('parentId') || '') || null,
    body: String(row.get('body') || ''),
    bodyHtml: String(row.get('bodyHtml') || ''),
    status: statusOf(row),
    authorId,
    authorName: live?.name || String(row.get('authorName') || '') || 'Someone',
    authorAvatar: live?.avatar || String(row.get('authorAvatar') || '') || null,
    authorIsStaff: row.get('authorIsStaff') === true,
    createdAt: iso(row.get('postedAt')) || iso(row.createdAt) || '',
    editedAt: iso(row.get('editedAt')),
    viewerIsAuthor: Boolean(viewerId && authorId && viewerId === authorId)
  }
}

export function readBlogCommentPage(query: Record<string, unknown>): { limit: number, skip: number } {
  const whole = (raw: unknown, fallback: number, min: number, max: number) => {
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) badRequest(`limit and skip must be whole numbers (limit up to ${BLOG_COMMENTS_PAGE_MAX})`)
    return n
  }
  return { limit: whole(query.limit, 50, 1, BLOG_COMMENTS_PAGE_MAX), skip: whole(query.skip, 0, 0, 100_000) }
}

/** A post's thread, oldest first. The team also sees what was hidden; nobody sees what was deleted. */
/** A members-only post's thread is for its members, like its body. */
function assertBlogPostReadable(ctx: BlogContext, post: ParseObject): void {
  if (post.get('visibility') === 'members' && !isBlogMember(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'This post is for members: sign in (and confirm your email) to join the discussion' })
}

export async function listBlogComments(ctx: BlogContext, post: ParseObject, page: { limit: number, skip: number }): Promise<BlogCommentPage> {
  assertBlogPostReadable(ctx, post)
  const build = () => {
    const query = new (useParse()).Query('BlogComment').equalTo('post', post)
    if (isBlogStaff(ctx.actor)) query.notEqualTo('status', 'deleted')
    else query.equalTo('status', 'visible')
    return query
  }
  const [rows, total] = await Promise.all([
    build().ascending('postedAt').addAscending('createdAt').skip(page.skip).limit(page.limit).find(MASTER),
    build().count(MASTER)
  ])
  const live = await liveAuthors(ctx.project, rows.map(row => String(row.get('authorExternalId') || '')))
  return { comments: rows.map(row => serializeBlogComment(row, blogActorId(ctx.actor), live.get(String(row.get('authorExternalId') || '')))), total, hasMore: page.skip + rows.length < total }
}

/** Every post's comments for the team's moderation list, newest first. */
export async function listProjectBlogComments(project: ParseObject, filter: { status?: BlogCommentStatus, postId?: string }, page: { limit: number, skip: number }): Promise<{ comments: BlogCommentWithPost[], total: number, hasMore: boolean }> {
  const build = () => {
    const query = new (useParse()).Query('BlogComment').equalTo('project', project)
    if (filter.status) query.equalTo('status', filter.status)
    else query.notEqualTo('status', 'deleted')
    if (filter.postId) query.equalTo('post', useParse().Object.extend('BlogPost').createWithoutData(filter.postId))
    return query
  }
  const [rows, total] = await Promise.all([
    build().include('post').descending('postedAt').skip(page.skip).limit(page.limit).find(MASTER),
    build().count(MASTER)
  ])
  const live = await liveAuthors(project, rows.map(row => String(row.get('authorExternalId') || '')))
  return {
    comments: rows.map((row) => {
      const post = row.get('post') as ParseObject | undefined
      return { ...serializeBlogComment(row, '', live.get(String(row.get('authorExternalId') || ''))), postTitle: String(post?.get('title') || ''), postSlug: String(post?.get('slug') || '') }
    }),
    total,
    hasMore: page.skip + rows.length < total
  }
}

/** Recounts the post's visible comments from the rows: increments drift the moment a status changes unpaired. */
export async function syncBlogCommentCount(post: ParseObject): Promise<number> {
  const count = await new (useParse()).Query('BlogComment').equalTo('post', post).equalTo('status', 'visible').count(MASTER)
  post.set('commentCount', count)
  await post.save(null, MASTER)
  return count
}

/**
 * Add a comment to a live post whose thread is open. A reader needs an
 * identity; an operator answers as the team. A reply to a reply joins the
 * thread of the comment it answers.
 */
export async function createBlogComment(ctx: BlogContext, post: ParseObject, payload: unknown): Promise<{ comment: ParseObject, text: string, commentCount: number }> {
  const actor = ctx.actor
  if (actor.kind === 'anonymous') throw createError({ statusCode: 401, statusMessage: 'Sign in to comment' })
  if (!ctx.config.comments || post.get('commentsOpen') === false || blogPostTypeOf(post) === 'page') throw createError({ statusCode: 403, statusMessage: 'Comments are closed' })
  if (!isBlogPostRowLive(post)) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  assertBlogPostReadable(ctx, post)

  const { body, parentId, errors } = readBlogCommentInput(payload)
  if (errors.length) badRequest(errors.join('; '))
  const checked = checkChangelogComment(body ?? '')
  if (checked.error) badRequest(checked.error)

  const Parse = useParse()
  let threadId = ''
  if (parentId) {
    const parent = await new Parse.Query('BlogComment').equalTo('post', post).equalTo('objectId', parentId).first(MASTER)
    if (!parent || statusOf(parent) === 'deleted') throw createError({ statusCode: 404, statusMessage: 'The comment you are replying to is gone' })
    threadId = String(parent.get('parentId') || '') || parent.id || ''
  }

  const authorId = blogActorId(actor)
  if (actor.kind === 'user') await rateLimit(`sb:rl:blogcomment:${ctx.project.id}:${actor.externalId}`, LIMITS.blogCommentsPerUser.limit, LIMITS.blogCommentsPerUser.window)
  // The same text twice in a row on the same post is a double-submit or a bot, never a person.
  const last = await new Parse.Query('BlogComment').equalTo('post', post).equalTo('authorExternalId', authorId).equalTo('status', 'visible').descending('postedAt').first(MASTER)
  if (last && changelogCommentText(String(last.get('body') || '')) === checked.text) throw createError({ statusCode: 409, statusMessage: 'You already posted that' })

  const comment = new (Parse.Object.extend('BlogComment'))() as ParseObject
  comment.set('project', ctx.project)
  comment.set('post', post)
  if (threadId) comment.set('parentId', threadId)
  comment.set('body', body)
  comment.set('bodyHtml', checked.bodyHtml)
  comment.set('status', 'visible')
  comment.set('postedAt', new Date())
  comment.set('authorExternalId', authorId)
  if (actor.kind === 'user') {
    const endUser = await ensureEndUser(ctx.project, actor.claims)
    comment.set('endUser', endUser)
    // Names are public on a blog, so never fall back to the email.
    comment.set('authorName', String(actor.claims.name || endUser.get('name') || endUser.get('username') || '').trim().slice(0, 120))
    comment.set('authorAvatar', safeAvatarUrl(actor.claims.avatar) || String(endUser.get('avatarUrl') || ''))
    comment.set('authorIsStaff', actor.isAdmin)
  } else {
    comment.set('authorName', String(actor.agent.get('name') || actor.agent.get('username') || 'The team').trim().slice(0, 120))
    comment.set('authorAvatar', String(actor.agent.get('avatarUrl') || ''))
    comment.set('authorIsStaff', true)
  }
  await comment.save(null, MASTER)
  return { comment, text: checked.text, commentCount: await syncBlogCommentCount(post) }
}

/** A comment of this project, with its post (a token or key for another project finds nothing). For scoped.blogComment and public routes. */
export async function getBlogComment(id: string): Promise<{ row: ParseObject, post: ParseObject }> {
  const row = /^[A-Za-z0-9]{1,40}$/.test(id) ? await new (useParse()).Query('BlogComment').include('post').get(id, MASTER).catch(() => undefined) : undefined
  const post = row?.get('post') as ParseObject | undefined
  if (!row || !post?.id || statusOf(row) === 'deleted') throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  return { row, post }
}

export async function loadBlogComment(id: string, projectId: string): Promise<{ row: ParseObject, post: ParseObject }> {
  const found = await getBlogComment(id)
  if (pointerId(found.row.get('project')) !== projectId) throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  return found
}

/**
 * `body` is the author editing their own words (a moderator does not rewrite
 * what someone said under their name); `status` is moderation (hide, show).
 */
export async function patchBlogComment(ctx: BlogContext, comment: { row: ParseObject, post: ParseObject }, payload: unknown): Promise<{ commentCount: number | null }> {
  if (ctx.actor.kind === 'anonymous') throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })
  const { body, status, errors } = readBlogCommentInput(payload)
  if (errors.length) badRequest(errors.join('; '))
  if (body === undefined && status === undefined) badRequest('Provide a body to edit or a status to moderate')
  if (status === 'deleted') badRequest('Delete a comment with DELETE')
  const isAuthor = comment.row.get('authorExternalId') === blogActorId(ctx.actor)

  if (body !== undefined) {
    if (!isAuthor) throw createError({ statusCode: 403, statusMessage: 'Only the author can edit a comment' })
    const checked = checkChangelogComment(body)
    if (checked.error) badRequest(checked.error)
    comment.row.set('body', body)
    comment.row.set('bodyHtml', checked.bodyHtml)
    comment.row.set('editedAt', new Date())
  }
  if (status !== undefined) {
    if (!isBlogStaff(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
    comment.row.set('status', status)
  }
  await comment.row.save(null, MASTER)
  return { commentCount: status !== undefined ? await syncBlogCommentCount(comment.post) : null }
}

/** Its author or a moderator takes a comment down: the words go, the row stays (its replies still hang off it). */
export async function deleteBlogComment(ctx: BlogContext, comment: { row: ParseObject, post: ParseObject }): Promise<number> {
  if (ctx.actor.kind === 'anonymous') throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })
  const isAuthor = comment.row.get('authorExternalId') === blogActorId(ctx.actor)
  if (!isAuthor && !isBlogStaff(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'Not allowed to delete this comment' })
  comment.row.set('status', 'deleted')
  comment.row.set('body', '')
  comment.row.set('bodyHtml', '')
  await comment.row.save(null, MASTER)
  return await syncBlogCommentCount(comment.post)
}

/**
 * Tell the blog's `commentNotify` addresses a reader commented. Never about
 * the team's own comments, and fire-and-forget: the comment is on the page
 * already, so a mail outage must not turn it into an error.
 */
export async function notifyBlogComment(ctx: BlogContext, post: ParseObject, comment: ParseObject, text: string): Promise<void> {
  try {
    const recipients = ctx.config.commentNotify
    if (!recipients.length || comment.get('authorIsStaff') === true) return
    const appName = String(ctx.project.get('name') || 'Blog')
    const sender = projectEmailSender(ctx.project, { fromName: `${appName} blog` })
    if (!isMailerConfigured(sender)) return
    const who = String(comment.get('authorName') || 'Someone')
    const title = String(post.get('title') || '')
    const { subject, html, text: plain } = renderMessageEmail({ appName, senderName: who, recipientName: '', subject: `New comment on “${title}”`, body: `${who} wrote:\n\n${text}`, ctaUrl: blogPostUrl(ctx.project, post), ctaLabel: 'Read the thread', attachmentUrls: [] })
    const batchId = newEmailBatchId()
    // The team's own alert, like the inbox's: it never counts against the plan's email.
    await deliverEmails(recipients.map(email => ({ project: ctx.project, to: { email, name: '' }, subject, html, text: plain, sender, unmetered: true, log: { source: 'notification', kind: 'message', templateName: 'Blog: comment', batchId, actor: SYSTEM_EMAIL_ACTOR } })))
  } catch (error) {
    console.error('[blog] comment notification failed:', (error as Error).message)
  }
}

/** Everything one person left on the blog (their account is being erased): their comments and their reactions. */
export async function eraseBlogData(project: ParseObject, externalId: string): Promise<{ comments: number, reactions: number }> {
  const Parse = useParse()
  const touched = new Map<string, ParseObject>()
  let comments = 0
  for (;;) {
    const rows = await new Parse.Query('BlogComment').equalTo('project', project).equalTo('authorExternalId', externalId).include('post').limit(1000).find(MASTER)
    if (!rows.length) break
    for (const row of rows) {
      const post = row.get('post') as ParseObject | undefined
      if (post?.id) touched.set(post.id, post)
    }
    await Parse.Object.destroyAll(rows, MASTER)
    comments += rows.length
  }
  // Reactions live on the posts; the key set is fixed, so every entry this person could own is known up front.
  const entries = BLOG_REACTIONS.map(key => blogReactionEntry(key, externalId))
  let reactions = 0
  await eachBatch(() => new Parse.Query('BlogPost').equalTo('project', project).containedIn('reactions', entries), async (rows) => {
    for (const row of rows) {
      const all = (row.get('reactions') as string[] | undefined) || []
      const kept = all.filter(entry => !entries.includes(entry))
      reactions += all.length - kept.length
      row.set('reactions', kept)
    }
    await Parse.Object.saveAll(rows, MASTER)
  })
  for (const post of touched.values()) await syncBlogCommentCount(post)
  return { comments, reactions }
}
