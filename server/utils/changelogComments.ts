import { createError, getHeader, getQuery, type H3Event } from 'h3'
import {
  CHANGELOG_COMMENTS_PAGE_MAX,
  readChangelogCommentImportItem,
  readChangelogCommentInput,
  type ChangelogComment,
  type ChangelogCommentPage,
  type ChangelogCommentStatus
} from '#shared/changelog'
import { changelogCommentText, checkChangelogComment, renderChangelogComment } from './changelogRender'
import { anonymousWriteGate } from './endUserSessions'

// Readers' comments on the public changelog. The sibling of changelog.ts and
// deliberately not the same module: entries are written by trusted people,
// comments by anybody with an account, so everything that differs between those
// threat models lives here: a tighter sanitiser, a rate limit, a duplicate
// guard and a moderation state.

export type CommentActor =
  | { kind: 'anonymous' }
  | { kind: 'user', externalId: string, name: string, isAdmin: boolean, claims: IdentityClaims }
  | { kind: 'agent', agent: ParseObject }

export type CommentContext = { project: ParseObject, actor: CommentActor }

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** Operators and the host's admins moderate; the author alone edits their words. */
export function canModerateChangelogComments(actor: CommentActor): boolean {
  return actor.kind === 'agent' || (actor.kind === 'user' && actor.isAdmin)
}

/**
 * Who is asking, and which project. A comment has an author, so the project
 * secret (a script, not a person) is refused; an identity token is a reader (or,
 * with `role: "admin"`, the host's staff); an operator moderates. `projectId`
 * pins the project when the route already knows it (a comment's own).
 */
export async function resolveCommentContext(event: H3Event, options: { projectId?: string } = {}): Promise<CommentContext> {
  const token = optionalBearer(event)
  const wrongProject = () => createError({ statusCode: 404, statusMessage: 'Not found' })

  if (token.startsWith('sk_')) throw createError({ statusCode: 401, statusMessage: 'Comments are written by signed-in users, not with the project secret' })

  if (token.startsWith('r:') || token.startsWith('ak_')) {
    const member = await requireMember(event, { can: 'content' })
    const id = options.projectId || String(getQuery(event).project || '')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
    return { project: await requireProject(member, id), actor: { kind: 'agent', agent: member.agent } }
  }

  if (token) {
    const { project, claims } = await verifyEndUserToken(event, token)
    if (options.projectId && project.id !== options.projectId) throw wrongProject()
    if (event.method !== 'GET' && event.method !== 'HEAD') await anonymousWriteGate(project, claims, 'comments')
    const actor: CommentActor = { kind: 'user', externalId: claims.sub, name: String(claims.name || '').trim().slice(0, 120), isAdmin: claims.role === 'admin', claims }
    if (!actor.isAdmin && !changelogIsPublic(project)) throw createError({ statusCode: 404, statusMessage: 'No changelog here' })
    return { project, actor }
  }

  const pk = String(getQuery(event).pk || getHeader(event, 'x-project-key') || '').trim()
  if (!pk) throw createError({ statusCode: 401, statusMessage: 'Pass ?pk=<public key> or an identity token' })
  const project = await findProjectByPublicKey(pk)
  if (!project || (options.projectId && project.id !== options.projectId)) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  await rateLimit(`sb:rl:clread:${clientIp(event) || 'ip'}`, LIMITS.changelogReadsPerIp.limit, LIMITS.changelogReadsPerIp.window)
  if (!changelogIsPublic(project)) throw createError({ statusCode: 404, statusMessage: 'No changelog here' })
  return { project, actor: { kind: 'anonymous' } }
}

/** The entry a thread belongs to. Readers see a public one; the team also sees a draft. An archived one is gone. */
export async function readableChangelogEntry(ctx: CommentContext, ref: string): Promise<ParseObject> {
  const row = await findChangelogEntry(ctx.project, ref)
  const visible = row && row.get('status') !== 'archived' && (canModerateChangelogComments(ctx.actor) || await isChangelogEntryPublic(row))
  if (!row || !visible) throw createError({ statusCode: 404, statusMessage: 'Changelog entry not found' })
  return row
}

// ---- reads -----------------------------------------------------------------------

type Live = { name: string, avatar: string }

/** Current names and avatars of a page's authors (a renamed account shows on old comments); stored copies are the fallback. */
async function liveAuthors(project: ParseObject, externalIds: string[]): Promise<Map<string, Live>> {
  const ids = [...new Set(externalIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await new (useParse()).Query('EndUser').equalTo('project', project).containedIn('externalId', ids).select('externalId', 'name', 'username', 'avatarUrl').limit(ids.length).find(MASTER)
  return new Map(rows.map(row => [String(row.get('externalId')), { name: String(row.get('name') || row.get('username') || ''), avatar: String(row.get('avatarUrl') || '') }]))
}

export function serializeChangelogComment(row: ParseObject, entry: ParseObject, viewerId: string, live?: Live): ChangelogComment {
  const authorId = String(row.get('authorExternalId') || '')
  const editedAt = iso(row.get('editedAt'))
  return {
    id: row.id || '',
    entryId: entry.id || '',
    entrySlug: changelogEntrySlug(entry),
    body: String(row.get('body') || ''),
    bodyHtml: String(row.get('bodyHtml') || ''),
    status: (['visible', 'hidden', 'deleted'].includes(String(row.get('status'))) ? row.get('status') : 'visible') as ChangelogCommentStatus,
    authorId,
    authorName: live?.name || String(row.get('authorName') || '') || 'Someone',
    authorAvatar: live?.avatar || String(row.get('authorAvatar') || '') || null,
    authorIsStaff: row.get('authorIsStaff') === true,
    createdAt: iso(row.get('postedAt')) || iso(row.createdAt) || '',
    updatedAt: iso(row.updatedAt) || '',
    editedAt,
    viewerIsAuthor: Boolean(viewerId && authorId && viewerId === authorId)
  }
}

/** The viewer's id for `viewerIsAuthor`: the host's user id, '' for anyone else. */
export function changelogCommentViewerId(actor: CommentActor): string {
  return actor.kind === 'user' ? actor.externalId : ''
}

/** A thread, oldest first (a conversation read newest-first is unreadable). The team also sees what was hidden; nobody sees what was deleted. */
export async function listChangelogComments(ctx: CommentContext, entry: ParseObject, page: { limit: number, skip: number }): Promise<ChangelogCommentPage> {
  const build = () => {
    const query = new (useParse()).Query('ChangelogComment').equalTo('entry', entry)
    if (canModerateChangelogComments(ctx.actor)) query.notEqualTo('status', 'deleted')
    else query.equalTo('status', 'visible')
    return query
  }
  const [rows, total] = await Promise.all([
    build().ascending('postedAt').addAscending('createdAt').skip(page.skip).limit(page.limit).find(MASTER),
    build().count(MASTER)
  ])
  const live = await liveAuthors(ctx.project, rows.map(row => String(row.get('authorExternalId') || '')))
  return {
    comments: rows.map(row => serializeChangelogComment(row, entry, changelogCommentViewerId(ctx.actor), live.get(String(row.get('authorExternalId') || '')))),
    total,
    hasMore: page.skip + rows.length < total
  }
}

export function readChangelogCommentPage(query: Record<string, unknown>): { limit: number, skip: number } {
  const whole = (raw: unknown, fallback: number, min: number, max: number) => {
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) throw createError({ statusCode: 400, statusMessage: `limit and skip must be whole numbers (limit up to ${CHANGELOG_COMMENTS_PAGE_MAX})` })
    return n
  }
  return { limit: whole(query.limit, 50, 1, CHANGELOG_COMMENTS_PAGE_MAX), skip: whole(query.skip, 0, 0, 100_000) }
}

// ---- writes ----------------------------------------------------------------------

/**
 * Recomputes the entry's `commentCount` from the rows themselves: a counter
 * query, not an increment, because increments drift the moment a status changes
 * in a way nobody paired with a decrement, and the number is printed next to
 * every entry on the list page.
 */
export async function syncChangelogCommentCount(entry: ParseObject): Promise<number> {
  const count = await new (useParse()).Query('ChangelogComment').equalTo('entry', entry).equalTo('status', 'visible').count(MASTER)
  entry.set('commentCount', count)
  await entry.save(null, MASTER)
  return count
}

/** Add a comment. Only a signed-in user writes one, on an entry the public can see, and the project must have comments on. */
export async function createChangelogComment(ctx: CommentContext, entry: ParseObject, payload: unknown): Promise<{ comment: ParseObject, text: string, commentCount: number }> {
  const actor = ctx.actor
  if (actor.kind !== 'user') throw createError({ statusCode: 401, statusMessage: 'Sign in to comment' })
  if (!getChangelogConfig(ctx.project).comments) throw createError({ statusCode: 403, statusMessage: 'Comments are turned off' })
  if (!await isChangelogEntryPublic(entry)) throw createError({ statusCode: 404, statusMessage: 'Changelog entry not found' })

  const { body, errors } = readChangelogCommentInput(payload)
  if (errors.length) badRequest(errors.join('; '))
  const checked = checkChangelogComment(body ?? '')
  if (checked.error) badRequest(checked.error)

  await rateLimit(`sb:rl:clcomment:${ctx.project.id}:${actor.externalId}`, LIMITS.changelogCommentsPerUser.limit, LIMITS.changelogCommentsPerUser.window)
  // The same text twice in a row on the same entry is a double-submit or a bot, never a person.
  const last = await new (useParse()).Query('ChangelogComment').equalTo('entry', entry).equalTo('authorExternalId', actor.externalId).equalTo('status', 'visible').descending('postedAt').addDescending('createdAt').first(MASTER)
  if (last && changelogCommentText(String(last.get('body') || '')) === checked.text) throw createError({ statusCode: 409, statusMessage: 'You already posted that' })

  const endUser = await ensureEndUser(ctx.project, actor.claims)
  const comment = new (useParse().Object.extend('ChangelogComment'))() as ParseObject
  comment.set('project', ctx.project)
  comment.set('entry', entry)
  comment.set('body', body)
  comment.set('bodyHtml', checked.bodyHtml)
  comment.set('status', 'visible')
  comment.set('postedAt', new Date())
  comment.set('endUser', endUser)
  comment.set('authorExternalId', actor.externalId)
  // Names are public on a changelog, so never fall back to the email.
  comment.set('authorName', String(actor.claims.name || endUser.get('name') || endUser.get('username') || '').trim().slice(0, 120))
  comment.set('authorAvatar', safeAvatarUrl(actor.claims.avatar) || String(endUser.get('avatarUrl') || ''))
  comment.set('authorIsStaff', actor.isAdmin)
  await comment.save(null, MASTER)
  return { comment, text: checked.text, commentCount: await syncChangelogCommentCount(entry) }
}

/** A comment of this project (a token or key for another project finds nothing), with the entry it is on. */
export async function loadChangelogComment(id: string, projectId: string): Promise<{ row: ParseObject, entry: ParseObject }> {
  const row = await new (useParse()).Query('ChangelogComment').include('entry').get(id, MASTER).catch(() => undefined)
  const entry = row?.get('entry') as ParseObject | undefined
  if (!row || !entry?.id || row.get('status') === 'deleted' || pointerId(row.get('project')) !== projectId) throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  return { row, entry }
}

function requireSignedIn(ctx: CommentContext): void {
  if (ctx.actor.kind === 'anonymous') throw createError({ statusCode: 401, statusMessage: 'Sign in to do that' })
}

/**
 * One route, two operations that must never be confused. `body` is the author
 * editing their own words: a moderator does not get this, because rewriting
 * what someone said under their name is a different thing from removing it.
 * `status` is moderation (hide, unhide).
 */
export async function patchChangelogComment(ctx: CommentContext, comment: { row: ParseObject, entry: ParseObject }, payload: unknown): Promise<{ commentCount: number | null }> {
  requireSignedIn(ctx)
  const { body, status, errors } = readChangelogCommentInput(payload)
  if (errors.length) badRequest(errors.join('; '))
  if (body === undefined && status === undefined) badRequest('Provide a body to edit or a status to moderate')
  const isAuthor = ctx.actor.kind === 'user' && comment.row.get('authorExternalId') === ctx.actor.externalId

  if (body !== undefined) {
    if (!isAuthor) throw createError({ statusCode: 403, statusMessage: 'Only the author can edit a comment' })
    const checked = checkChangelogComment(body)
    if (checked.error) badRequest(checked.error)
    comment.row.set('body', body)
    comment.row.set('bodyHtml', checked.bodyHtml)
    // Shown as "edited": a comment that changed after people read it should say so.
    comment.row.set('editedAt', new Date())
  }
  if (status !== undefined) {
    if (!canModerateChangelogComments(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
    comment.row.set('status', status)
  }
  await comment.row.save(null, MASTER)
  return { commentCount: status !== undefined ? await syncChangelogCommentCount(comment.entry) : null }
}

/** Remove a comment: its author or a moderator. The words go (that is what taking one down means); the row stays. */
export async function deleteChangelogComment(ctx: CommentContext, comment: { row: ParseObject, entry: ParseObject }): Promise<number> {
  requireSignedIn(ctx)
  const isAuthor = ctx.actor.kind === 'user' && comment.row.get('authorExternalId') === ctx.actor.externalId
  if (!isAuthor && !canModerateChangelogComments(ctx.actor)) throw createError({ statusCode: 403, statusMessage: 'Not allowed to delete this comment' })
  comment.row.set('status', 'deleted')
  comment.row.set('body', '')
  comment.row.set('bodyHtml', '')
  await comment.row.save(null, MASTER)
  return await syncChangelogCommentCount(comment.entry)
}

// ---- import ----------------------------------------------------------------------

export type ChangelogCommentImportResult = {
  results: { index: number, id: string, externalId: string, created: boolean }[]
  failed: { index: number, message: string }[]
}

/**
 * Bring comments over from another system (up to 100): each is created, or
 * updated when one with its `externalId` exists. The entry is named by its
 * `externalId`, slug or `#N`. It keeps the author, the date and the status it is
 * given, and skips the rate limit, the duplicate guard and the notification (it
 * is history, not someone commenting); the entries' counts are recomputed after.
 */
export async function importChangelogComments(project: ParseObject, payload: unknown): Promise<ChangelogCommentImportResult> {
  const items = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).comments : undefined)
  if (!Array.isArray(items) || !items.length || items.length > 100) badRequest('comments must be an array of 1 to 100 comments')
  const Parse = useParse()
  const result: ChangelogCommentImportResult = { results: [], failed: [] }
  const touched = new Map<string, ParseObject>()
  const entries = new Map<string, ParseObject | null>()

  for (const [index, item] of items.entries()) {
    try {
      const { values, errors } = readChangelogCommentImportItem(item)
      if (errors.length) badRequest(errors.join('; '))
      if (!entries.has(values.entry)) {
        entries.set(values.entry, await Parse.Query.or(
          new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('externalId', values.entry),
          new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('slug', values.entry)
        ).first(MASTER) || await findChangelogEntry(project, values.entry) || null)
      }
      const entry = entries.get(values.entry)
      if (!entry) throw createError({ statusCode: 404, statusMessage: `Entry not found: ${values.entry}` })

      const existing = await new Parse.Query('ChangelogComment').equalTo('project', project).equalTo('externalId', values.externalId).first(MASTER)
      const row = existing || new (Parse.Object.extend('ChangelogComment'))() as ParseObject
      row.set('project', project)
      row.set('entry', entry)
      row.set('externalId', values.externalId)
      row.set('status', values.status)
      row.set('body', values.status === 'deleted' ? '' : values.body)
      row.set('bodyHtml', values.status === 'deleted' ? '' : renderChangelogComment(values.body))
      row.set('authorExternalId', values.authorId)
      row.set('authorName', values.authorName)
      row.set('authorAvatar', values.authorAvatar)
      row.set('authorIsStaff', values.authorIsStaff)
      if (values.postedAt) row.set('postedAt', values.postedAt)
      else if (!existing) row.set('postedAt', new Date())
      if (values.editedAt) row.set('editedAt', values.editedAt)
      await row.save(null, MASTER)
      touched.set(entry.id || '', entry)
      result.results.push({ index, id: row.id || '', externalId: values.externalId, created: !existing })
    } catch (error) {
      result.failed.push({ index, message: String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Could not import the comment') })
    }
  }
  for (const entry of touched.values()) await syncChangelogCommentCount(entry)
  return result
}

// ---- notification and erasure ----------------------------------------------------

/**
 * Tell the project's `commentNotify` addresses a comment landed: a thread
 * nobody is told about is a thread nobody answers. Never about the team's own
 * comments, and fire-and-forget: the comment is stored and on the page already,
 * so a mail outage must not turn a successful post into an error.
 */
export async function notifyChangelogComment(project: ParseObject, entry: ParseObject, comment: ParseObject, text: string): Promise<void> {
  try {
    const recipients = getChangelogConfig(project).commentNotify
    if (!recipients.length || comment.get('authorIsStaff') === true) return
    const appName = String(project.get('name') || 'Changelog')
    const sender = projectEmailSender(project, { fromName: `${appName} changelog` })
    if (!isMailerConfigured(sender)) return
    const who = String(comment.get('authorName') || 'Someone')
    const title = String(entry.get('title') || '')
    const { subject, html, text: plain } = renderMessageEmail({ appName, senderName: who, recipientName: '', subject: `New comment on “${title}”`, body: `${who} wrote:\n\n${text}`, ctaUrl: changelogEntryUrl(project, entry), ctaLabel: 'Read the thread', attachmentUrls: [] })
    const batchId = newEmailBatchId()
    // The team's own alert, like the inbox's: it never counts against the plan's email.
    await deliverEmails(recipients.map(email => ({ project, to: { email, name: '' }, subject, html, text: plain, sender, unmetered: true, log: { source: 'notification', kind: 'message', templateName: 'Changelog: comment', batchId, actor: SYSTEM_EMAIL_ACTOR } })))
  } catch (error) {
    console.error('[changelog] comment notification failed:', (error as Error).message)
  }
}

/** Delete everything one person wrote on the changelog (their account is being erased); the entries' counts follow. */
export async function eraseChangelogComments(project: ParseObject, externalId: string): Promise<number> {
  const Parse = useParse()
  let erased = 0
  const touched = new Map<string, ParseObject>()
  for (;;) {
    const rows = await new Parse.Query('ChangelogComment').equalTo('project', project).equalTo('authorExternalId', externalId).include('entry').limit(1000).find(MASTER)
    if (!rows.length) break
    for (const row of rows) {
      const entry = row.get('entry') as ParseObject | undefined
      if (entry?.id) touched.set(entry.id, entry)
    }
    await Parse.Object.destroyAll(rows, MASTER)
    erased += rows.length
  }
  for (const entry of touched.values()) await syncChangelogCommentCount(entry)
  return erased
}
