import { createError } from 'h3'
import {
  BOARD_LINKS_MAX,
  ROADMAP_CATEGORIES,
  normalizeBoardConfig,
  readBoardItemInput,
  readErrorRefs,
  toRoadmapItem,
  type BoardConfig,
  type BoardItem,
  type BoardItemPriority,
  type BoardItemValues,
  type BoardLinkedConversation,
  type BoardLinkedPost,
  type RoadmapResponse
} from '#shared/board'
import { defaultFeedbackStatus, feedbackStatusCategory, parsePostRef, type FeedbackStatusCategory } from '#shared/feedback'
import type { FeedbackContext } from './feedback'

// Project boards: Linear-style items an operator triages on a kanban, linked to
// the feedback posts and support conversations they answer. Operators only —
// every route here sits behind requireMember — except the public roadmap, which
// reads through the feedback board's own context (`?pk=`, a token or an
// operator) and sends an allow-list of public items.

export type BoardLinkKind = 'feedback' | 'conversation'

export function getBoardConfig(project: ParseObject): BoardConfig {
  return normalizeBoardConfig(project.get('board'))
}

function badRequest(errors: string[]): never {
  throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

// ---- reads ------------------------------------------------------------------

// The kanban shows every item at once; a board past this many errors rather than quietly losing some.
const BOARD_ITEMS_MAX = 10_000

/** Rank, then number: the board's order. Items are read by id, so they are put in order here. */
function byRank(a: ParseObject, b: ParseObject): number {
  const compare = (key: string) => {
    const x = typeof a.get(key) === 'number' ? a.get(key) as number : -Infinity
    const y = typeof b.get(key) === 'number' ? b.get(key) as number : -Infinity
    return x < y ? -1 : x > y ? 1 : 0
  }
  return compare('rank') || compare('number')
}

/** An item by object id, or by its number when the operator names the project. */
export async function loadBoardItem(id: string, projectId?: string): Promise<{ project: ParseObject, row: ParseObject }> {
  const Parse = useParse()
  let row: ParseObject | undefined = await new Parse.Query('BoardItem').get(id, MASTER).catch(() => undefined)
  if (!row && projectId) {
    const number = parsePostRef(id.replace(/^#/, ''))
    if (number) row = await new Parse.Query('BoardItem').equalTo('project', await loadProjectUnscoped(projectId)).equalTo('number', number).first(MASTER)
  }
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  return { project: await loadProjectUnscoped(pointerId(row.get('project'))), row }
}

/**
 * Serialize a page of items with their links resolved in one query per kind.
 * Ids that no longer resolve (the post or conversation was deleted) are
 * skipped; `voteCount` sums the linked posts that are not hidden.
 */
export async function serializeBoardItems(project: ParseObject, rows: ParseObject[], options: { board?: BoardConfig, conversations?: boolean } = {}): Promise<BoardItem[]> {
  const Parse = useParse()
  const board = options.board || getBoardConfig(project)
  const feedback = getFeedbackConfig(project)
  const postIds = unique(rows.flatMap(row => stringList(row.get('feedbackPostIds'))))
  const conversationIds = options.conversations === false ? [] : unique(rows.flatMap(row => stringList(row.get('conversationIds'))))

  // A whole board links more posts than one read returns: in batches, never more than were asked for.
  const [postRows, conversationRows] = await Promise.all([
    postIds.length ? collectAll(() => new Parse.Query('FeedbackPost').equalTo('project', project).containedIn('objectId', postIds), { max: postIds.length, keys: ['title', 'status', 'number', 'voteCount', 'hidden'] }) : [],
    conversationIds.length ? collectAll(() => new Parse.Query('Conversation').equalTo('project', project).containedIn('objectId', conversationIds).include('endUser'), { max: conversationIds.length }) : []
  ])
  const posts = new Map<string, BoardLinkedPost>(postRows.map(row => [row.id || '', { ...feedbackPostRef(row, feedback), voteCount: Number(row.get('voteCount') || 0), hidden: row.get('hidden') === true }]))
  const conversations = new Map<string, BoardLinkedConversation>(conversationRows.map((row) => {
    const endUser = row.get('endUser') as ParseObject | undefined
    const endUserName = endUser && typeof endUser.get === 'function' ? String(endUser.get('name') || endUser.get('email') || endUser.get('externalId') || '') : ''
    return [row.id || '', { id: row.id || '', subject: String(row.get('subject') || ''), status: String(row.get('status') || ''), endUserName }]
  }))

  return rows.map((row) => {
    const status = String(row.get('status') || defaultFeedbackStatus(board).key)
    const linkedPosts = stringList(row.get('feedbackPostIds')).map(id => posts.get(id)).filter((post): post is BoardLinkedPost => Boolean(post))
    const priority = String(row.get('priority') || '')
    return {
      id: row.id || '',
      projectId: pointerId(row.get('project')),
      number: typeof row.get('number') === 'number' ? row.get('number') : null,
      title: String(row.get('title') || ''),
      description: String(row.get('description') || ''),
      publicDescription: String(row.get('publicDescription') || ''),
      status,
      statusCategory: feedbackStatusCategory(board, status),
      rank: Number(row.get('rank') || 0),
      priority: (['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : '') as BoardItemPriority,
      assigneeId: pointerId(row.get('assignee')),
      labels: stringList(row.get('labels')),
      targetDate: iso(row.get('targetDate')),
      public: row.get('public') === true,
      feedbackPostIds: stringList(row.get('feedbackPostIds')),
      conversationIds: stringList(row.get('conversationIds')),
      errorRefs: readErrorRefs(row.get('errorRefs')),
      voteCount: linkedPosts.filter(post => !post.hidden).reduce((sum, post) => sum + post.voteCount, 0),
      posts: linkedPosts,
      conversations: stringList(row.get('conversationIds')).map(id => conversations.get(id)).filter((c): c is BoardLinkedConversation => Boolean(c)),
      completedAt: iso(row.get('completedAt')),
      createdAt: iso(row.createdAt) || '',
      updatedAt: iso(row.updatedAt) || ''
    }
  })
}

export async function serializeBoardItem(project: ParseObject, row: ParseObject): Promise<BoardItem> {
  return (await serializeBoardItems(project, [row]))[0]!
}

/** Every item on the board (or those linked to one post or conversation), in rank order. */
export async function listBoardItems(project: ParseObject, filter: { conversation?: string, feedbackPost?: string } = {}): Promise<BoardItem[]> {
  const rows = await collectAll(() => {
    const query = new (useParse()).Query('BoardItem').equalTo('project', project)
    if (filter.conversation) query.equalTo('conversationIds', filter.conversation)
    if (filter.feedbackPost) query.equalTo('feedbackPostIds', filter.feedbackPost)
    return query
  }, { max: BOARD_ITEMS_MAX })
  return serializeBoardItems(project, rows.sort(byRank))
}

// ---- writes -----------------------------------------------------------------

async function setAssignee(row: ParseObject, assigneeId: string): Promise<void> {
  if (!assigneeId) { row.unset('assignee'); return }
  const assignee = await new (useParse()).Query('_User').get(assigneeId, MASTER).catch(() => null)
  if (!assignee) badRequest(['Assignee not found'])
  await assertAssignable(await workspaceIdOfProject(pointerId(row.get('project'))), assigneeId)
  row.set('assignee', assignee)
}

function applyValues(row: ParseObject, values: BoardItemValues): void {
  for (const key of ['title', 'description', 'publicDescription', 'status', 'rank', 'priority', 'labels', 'public'] as const) {
    if (values[key] !== undefined) row.set(key, values[key])
  }
  if (values.targetDate === null) row.unset('targetDate')
  else if (values.targetDate) row.set('targetDate', values.targetDate)
}

type LinkTarget = { kind: 'feedback', id: string, row: ParseObject } | { kind: 'conversation', id: string, row: ParseObject }

/** A post (by id or `#N`) or a conversation in this project; 404 for anything else. */
async function resolveLinkTarget(project: ParseObject, kind: BoardLinkKind, rawId: string): Promise<LinkTarget> {
  const id = String(rawId || '').trim()
  if (kind === 'feedback') {
    const post = id ? await findFeedbackPost(project, id.replace(/^#/, '')) : undefined
    if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
    return { kind, id: post.id || '', row: post }
  }
  const conversation = id ? await getConversation(id) : null
  if (!conversation || pointerId(conversation.get('project')) !== project.id) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  return { kind, id: conversation.id || '', row: conversation }
}

function readLinkKind(value: unknown): BoardLinkKind {
  if (value === 'feedback' || value === 'conversation') return value
  badRequest(['kind must be feedback or conversation'])
}

function readIdList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) badRequest([`${label} must be an array`])
  const ids = unique(value.map(v => String(v ?? '').trim()))
  if (ids.length > BOARD_LINKS_MAX) badRequest([`An item links at most ${BOARD_LINKS_MAX} ${label === 'feedbackPostIds' ? 'posts' : 'conversations'}`])
  return ids
}

/** Add or remove one link with $addToSet / $pull, so two operators linking at once both land. */
async function applyLink(row: ParseObject, target: LinkTarget, linked: boolean, agent: ParseObject): Promise<void> {
  const field = target.kind === 'feedback' ? 'feedbackPostIds' : 'conversationIds'
  const ids = stringList(row.get(field))
  if (linked === ids.includes(target.id)) return
  if (linked && ids.length >= BOARD_LINKS_MAX) badRequest([`An item links at most ${BOARD_LINKS_MAX} ${target.kind === 'feedback' ? 'posts' : 'conversations'}`])
  if (linked) row.addUnique(field, target.id)
  else row.remove(field, target.id)
  await row.save(null, MASTER)
  if (target.kind === 'conversation') {
    await appendEvent(target.row, { type: linked ? 'board.linked' : 'board.unlinked', itemId: row.id || '', number: row.get('number') ?? null, title: String(row.get('title') || '') }, agent)
  }
}

export async function createBoardItem(project: ParseObject, agent: ParseObject, payload: unknown): Promise<ParseObject> {
  const board = getBoardConfig(project)
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const { values, errors } = readBoardItemInput(raw, board, { create: true })
  if (errors.length) badRequest(errors)
  // Resolve the links first, so a bad one fails the request before anything is written.
  const targets: LinkTarget[] = []
  for (const id of readIdList(raw.feedbackPostIds, 'feedbackPostIds')) targets.push(await resolveLinkTarget(project, 'feedback', id))
  for (const id of readIdList(raw.conversationIds, 'conversationIds')) targets.push(await resolveLinkTarget(project, 'conversation', id))

  const Parse = useParse()
  const row = new (Parse.Object.extend('BoardItem'))() as ParseObject
  row.set('project', project)
  row.set('description', '')
  row.set('publicDescription', '')
  row.set('status', defaultFeedbackStatus(board).key)
  // Milliseconds since the epoch: a new item lands at the bottom of its column without a query.
  row.set('rank', Date.now())
  row.set('priority', '')
  row.set('labels', [])
  row.set('feedbackPostIds', [])
  row.set('conversationIds', [])
  applyValues(row, values)
  if (values.assigneeId) await setAssignee(row, values.assigneeId)
  const { completedAt } = statusTransition(board, '', String(row.get('status')), undefined, new Date())
  if (completedAt) row.set('completedAt', completedAt)
  row.set('number', await allocateProjectNumber(project, 'boardItemSeq', 'BoardItem'))
  await row.save(null, MASTER)
  for (const target of targets) await applyLink(row, target, true, agent)
  return row
}

/**
 * Edit an item. The first move into a done status stamps `completedAt`. With
 * the board's `syncFeedback` on, a change of status category moves every
 * linked post to the feedback board's first status of that category, through
 * the same path an admin edit takes — so followers get the usual emails.
 */
export async function updateBoardItem(project: ParseObject, agent: ParseObject, row: ParseObject, payload: unknown): Promise<ParseObject> {
  const board = getBoardConfig(project)
  const { values, errors } = readBoardItemInput(payload, board, { create: false })
  if (errors.length) badRequest(errors)
  const from = String(row.get('status') || '')
  applyValues(row, values)
  if (values.assigneeId !== undefined) await setAssignee(row, values.assigneeId)
  const to = String(row.get('status') || '')
  const transition = statusTransition(board, from, to, row.get('completedAt') as Date | undefined, new Date())
  if (transition.completedAt) row.set('completedAt', transition.completedAt)
  await row.save(null, MASTER)

  const category = feedbackStatusCategory(board, to)
  // An item that has just shipped may get a draft changelog entry. Before the sync below, so
  // the entry links the item's posts before each of them tries to draft one of its own.
  if (transition.changed && category === 'done' && feedbackStatusCategory(board, from) !== 'done') {
    await draftChangelogFor(project, 'board', row, agent).catch(error => console.error('[changelog] could not draft for item', row.id, (error as Error).message))
  }
  if (transition.changed && board.syncFeedback && feedbackStatusCategory(board, from) !== category) await syncLinkedPosts(project, agent, row, category)
  return row
}

async function syncLinkedPosts(project: ParseObject, agent: ParseObject, row: ParseObject, category: FeedbackStatusCategory): Promise<void> {
  const config = getFeedbackConfig(project)
  const status = config.statuses.find(s => s.category === category)
  if (!status) return
  const ctx: FeedbackContext = { project, config, actor: { kind: 'agent', agent } }
  for (const id of stringList(row.get('feedbackPostIds'))) {
    try {
      const post = await findFeedbackPost(project, id)
      if (!post || feedbackStatusCategory(config, post.get('status')) === category) continue
      await updateFeedbackPost(ctx, post, { status: status.key })
    } catch (error) {
      // One stubborn post never undoes the item's own move.
      console.error('[board] could not sync post', id, (error as Error).message)
    }
  }
}

/** Link or unlink one post (`id` or `#N`) or conversation. Linking a conversation notes it on its timeline. */
export async function linkBoardItem(project: ParseObject, agent: ParseObject, row: ParseObject, kind: BoardLinkKind, id: string, linked: boolean): Promise<ParseObject> {
  let target: LinkTarget
  try {
    target = await resolveLinkTarget(project, kind, id)
  } catch (error) {
    // Unlinking something deleted since: drop the stale id as stored.
    const field = kind === 'feedback' ? 'feedbackPostIds' : 'conversationIds'
    if (linked || !stringList(row.get(field)).includes(id)) throw error
    row.remove(field, id)
    await row.save(null, MASTER)
    return await new (useParse()).Query('BoardItem').get(row.id || '', MASTER)
  }
  await applyLink(row, target, linked, agent)
  // Re-read after the atomic op, so the response carries the stored arrays.
  return await new (useParse()).Query('BoardItem').get(row.id || '', MASTER)
}

/** The body of POST …/links: `{ kind, id, linked }`. */
export function readLinkInput(payload: unknown): { kind: BoardLinkKind, id: string, linked: boolean } {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const kind = readLinkKind(raw.kind)
  const id = String(raw.id ?? '').trim()
  if (!id) badRequest(['id is required'])
  return { kind, id, linked: raw.linked !== false }
}

export async function deleteBoardItem(row: ParseObject): Promise<void> {
  await row.destroy(MASTER)
}

// ---- the public roadmap -----------------------------------------------------

/**
 * Where the public roadmap comes from. The board takes it over only once it
 * has something to show: items start private, so switching the board on must
 * not swap a roadmap full of posts for an empty one.
 */
export async function roadmapSourceOf(project: ParseObject): Promise<'board' | 'posts'> {
  const board = getBoardConfig(project)
  if (!board.enabled) return 'posts'
  const statuses = board.statuses.filter(status => ROADMAP_CATEGORIES.includes(status.category)).map(status => status.key)
  if (!statuses.length) return 'posts'
  const published = await new (useParse()).Query('BoardItem').equalTo('project', project).equalTo('public', true).containedIn('status', statuses).first(MASTER)
  return published ? 'board' : 'posts'
}

/**
 * Public items in a planned, active or done status, with only the board's
 * roadmap statuses (Backlog and Canceled never go out by name) and only the
 * linked posts that are not hidden. Signed-in viewers also get `hasVoted`.
 */
export async function listRoadmap(ctx: FeedbackContext, board: BoardConfig): Promise<RoadmapResponse> {
  const statuses = board.statuses.filter(status => ROADMAP_CATEGORIES.includes(status.category))
  const rows = statuses.length
    ? await new (useParse()).Query('BoardItem')
      .equalTo('project', ctx.project)
      .equalTo('public', true)
      .containedIn('status', statuses.map(status => status.key))
      .ascending('rank').addAscending('number')
      .limit(1000)
      .find(MASTER)
    : []
  const items = await serializeBoardItems(ctx.project, rows, { board, conversations: false })
  const visible = unique(items.flatMap(item => item.posts.filter(post => !post.hidden).map(post => post.id)))
  const viewer = await feedbackViewerState(ctx, visible)
  const signedIn = ctx.actor.kind === 'user'
  return {
    options: board.roadmap,
    statuses,
    ...(board.roadmap.showLabels ? { labels: board.labels } : {}),
    items: items.map(item => toRoadmapItem(item, item.posts.map(post => (signedIn ? { ...post, hasVoted: viewer.voted.has(post.id) } : post)), board.roadmap))
  }
}
