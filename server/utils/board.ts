import { createError } from 'h3'
import {
  BOARD_DESCRIPTION_FILE,
  BOARD_LINKS_MAX,
  ROADMAP_CATEGORIES,
  kindCanHave,
  normalizeBoardConfig,
  overflowedDescription,
  readBoardItemInput,
  readErrorRefs,
  toRoadmapItem,
  type BoardConfig,
  type BoardItem,
  type BoardItemHistoryChange,
  type BoardItemKind,
  type BoardItemPriority,
  type BoardItemValues,
  type BoardLinkedConversation,
  type BoardLinkedPost,
  type BoardProgress,
  type BoardRelatedItem,
  type RoadmapResponse
} from '#shared/board'
import { defaultFeedbackStatus, FEEDBACK_BODY_MAX_LENGTH, feedbackStatusCategory, parsePostRef, type FeedbackStatusCategory } from '#shared/feedback'
import { ITEM_ATTACHMENTS_MAX, type ItemAttachment } from '#shared/itemAttachments'
import type { FeedbackContext } from './feedback'
import { eachBatch } from './batches'
import { emitDomainEventLater } from './domainEvents'
import type { ClientSource } from './clientSource'

// Project boards: Linear-style items an operator triages on a kanban, linked to
// the feedback posts and support conversations they answer. Operators only —
// every route here sits behind requireMember — except the public roadmap, which
// reads through the feedback board's own context (`?pk=`, a token or an
// operator) and sends an allow-list of public items.

export type BoardLinkKind = 'feedback' | 'conversation' | 'item'

/** The id field each link kind lives in on the item. */
const LINK_FIELD: Record<BoardLinkKind, string> = { feedback: 'feedbackPostIds', conversation: 'conversationIds', item: 'relatedItemIds' }
const LINK_NOUN: Record<BoardLinkKind, string> = { feedback: 'posts', conversation: 'conversations', item: 'items' }

export function getBoardConfig(project: ParseObject): BoardConfig {
  return normalizeBoardConfig(project.get('board'))
}

function badRequest(errors: string[]): never {
  throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

const HISTORY_FIELDS = [
  'title', 'kind', 'epicId', 'releaseId', 'description', 'publicDescription', 'status', 'rank', 'priority', 'assignee', 'labels', 'attachments',
  'targetDate', 'estimate', 'public', 'feedbackPostIds', 'conversationIds', 'relatedItemIds', 'completedAt', 'errorRefs', 'errorKeys'
] as const

function historyValue(row: ParseObject, field: string): unknown {
  const value = field === 'assignee' ? pointerId(row.get(field)) || null : row.get(field)
  if (value instanceof Date) return value.toISOString()
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

function historyChanges(before: Record<string, unknown>, row: ParseObject): BoardItemHistoryChange[] {
  return HISTORY_FIELDS.flatMap(field => {
    const from = before[field] ?? null
    const to = historyValue(row, field)
    return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ field, from, to }]
  })
}

/** Fields a `board.item.updated` event reports. Long text, links and the rank stay out: events carry ids and short values. */
const UPDATED_EVENT_FIELDS = new Set<string>(['title', 'kind', 'epicId', 'releaseId', 'priority', 'labels', 'targetDate', 'estimate', 'public'])

/** Who did it, on every board event: lets a webhook or flow tell a person from the API. */
function eventActor(agent: ParseObject, source: ClientSource): { source: ClientSource, by: string } {
  return { source, by: agent.id || '' }
}

function historySnapshot(row: ParseObject): Record<string, unknown> {
  return Object.fromEntries(HISTORY_FIELDS.map(field => [field, historyValue(row, field)]))
}

export function markBoardItem(row: ParseObject, agent: ParseObject, source: ClientSource): void {
  row.set('lastModifiedBy', String(agent.get('name') || agent.get('username') || 'Unknown'))
  row.set('lastModifiedSource', source)
}

/** Save one immutable before/after record after the corresponding item write succeeds. */
export async function recordBoardItemHistory(project: ParseObject, row: ParseObject, agent: ParseObject, source: ClientSource, action: 'created' | 'updated', changes: BoardItemHistoryChange[]): Promise<void> {
  if (action === 'updated' && !changes.length) return
  const actorName = String(agent.get('name') || agent.get('username') || 'Unknown')
  const history = new (useParse().Object.extend('BoardItemHistory'))()
  history.set('project', project)
  history.set('itemId', row.id || '')
  if (typeof row.get('number') === 'number') history.set('itemNumber', row.get('number'))
  history.set('itemTitle', String(row.get('title') || ''))
  history.set('actorId', agent.id || '')
  history.set('actorName', actorName)
  history.set('source', source)
  history.set('action', action)
  history.set('changes', changes)
  await history.save(null, MASTER)
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

/** Rows saved before epics were kinds, and the release kind this replaced, are cards. */
function kindOf(row: ParseObject): BoardItemKind {
  return row.get('kind') === 'epic' ? 'epic' : 'task'
}

export const EMPTY_PROGRESS: BoardProgress = { total: 0, done: 0, estimateTotal: 0, estimateDone: 0 }

/**
 * How far each changelog release is: its cards, and those in a done status, by count and by points.
 * A release is not a board item, so its progress is worked out from the cards that name it.
 */
export async function releaseProgress(project: ParseObject, releaseIds: string[]): Promise<Map<string, BoardProgress>> {
  const progress = new Map<string, BoardProgress>()
  if (!releaseIds.length) return progress
  const board = getBoardConfig(project)
  const cards = await collectAll(() => new (useParse()).Query('BoardItem').equalTo('project', project).containedIn('releaseId', releaseIds), { max: BOARD_ITEMS_MAX, keys: ['status', 'releaseId', 'estimate'] })
  for (const card of cards) {
    const entry = progress.get(String(card.get('releaseId') || '')) || { ...EMPTY_PROGRESS }
    const points = Number(card.get('estimate')) || 0
    entry.total++
    entry.estimateTotal += points
    if (feedbackStatusCategory(board, String(card.get('status') || '')) === 'done') { entry.done++; entry.estimateDone += points }
    progress.set(String(card.get('releaseId') || ''), entry)
  }
  return progress
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
  const relatedIds = unique(rows.flatMap(row => stringList(row.get('relatedItemIds'))))
  const parentIds = unique(rows.map(row => String(row.get('epicId') || '')))
  const releaseIds = unique(rows.map(row => String(row.get('releaseId') || '')))
  const groupIds = rows.filter(row => kindOf(row) === 'epic').map(row => row.id || '')

  // A whole board links more posts than one read returns: in batches, never more than were asked for.
  const [postRows, conversationRows, relatedRows, parentRows, releaseRows, childCards] = await Promise.all([
    postIds.length ? collectAll(() => new Parse.Query('FeedbackPost').equalTo('project', project).containedIn('objectId', postIds), { max: postIds.length, keys: ['title', 'status', 'number', 'voteCount', 'hidden'] }) : [],
    conversationIds.length ? collectAll(() => new Parse.Query('Conversation').equalTo('project', project).containedIn('objectId', conversationIds).include('endUser'), { max: conversationIds.length }) : [],
    relatedIds.length ? collectAll(() => new Parse.Query('BoardItem').equalTo('project', project).containedIn('objectId', relatedIds), { max: relatedIds.length, keys: ['number', 'title', 'status'] }) : [],
    parentIds.length ? collectAll(() => new Parse.Query('BoardItem').equalTo('project', project).containedIn('objectId', parentIds), { max: parentIds.length, keys: ['number', 'title', 'status'] }) : [],
    releaseIds.some(Boolean) ? collectAll(() => new Parse.Query('ChangelogRelease').equalTo('project', project).containedIn('objectId', releaseIds.filter(Boolean)), { max: releaseIds.length, keys: ['version', 'status'] }) : [],
    groupIds.length ? collectAll(() => new Parse.Query('BoardItem').equalTo('project', project).containedIn('epicId', groupIds), { max: BOARD_ITEMS_MAX, keys: ['status', 'epicId', 'estimate'] }) : []
  ])
  const ref = (row: ParseObject): [string, BoardRelatedItem] => [row.id || '', { id: row.id || '', number: typeof row.get('number') === 'number' ? row.get('number') : null, title: String(row.get('title') || ''), status: String(row.get('status') || '') }]
  const related = new Map<string, BoardRelatedItem>(relatedRows.map(ref))
  const parents = new Map<string, BoardRelatedItem>(parentRows.map(ref))
  // A release is named by its version, and its status is the changelog's (draft or published).
  const releases = new Map<string, BoardRelatedItem>(releaseRows.map(row => [row.id || '', { id: row.id || '', number: null, title: String(row.get('version') || ''), status: String(row.get('status') || '') }]))
  const progress = new Map<string, BoardProgress>()
  // A card under an epic counts for it, once per card.
  for (const child of new Map(childCards.flat().map(card => [card.id, card])).values()) {
    const done = feedbackStatusCategory(board, String(child.get('status') || '')) === 'done'
    const parent = String(child.get('epicId') || '')
    const entry = progress.get(parent) || { ...EMPTY_PROGRESS }
    const points = Number(child.get('estimate')) || 0
    entry.total++
    entry.estimateTotal += points
    if (done) { entry.done++; entry.estimateDone += points }
    progress.set(parent, entry)
  }
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
      kind: kindOf(row),
      description: String(row.get('description') || ''),
      publicDescription: String(row.get('publicDescription') || ''),
      status,
      statusCategory: feedbackStatusCategory(board, status),
      rank: Number(row.get('rank') || 0),
      priority: (['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : '') as BoardItemPriority,
      assigneeId: pointerId(row.get('assignee')),
      labels: stringList(row.get('labels')),
      attachments: itemAttachments(row.get('attachments')),
      targetDate: iso(row.get('targetDate')),
      estimate: typeof row.get('estimate') === 'number' ? row.get('estimate') : null,
      public: row.get('public') === true,
      feedbackPostIds: stringList(row.get('feedbackPostIds')),
      conversationIds: stringList(row.get('conversationIds')),
      relatedItemIds: stringList(row.get('relatedItemIds')),
      related: stringList(row.get('relatedItemIds')).map(id => related.get(id)).filter((item): item is BoardRelatedItem => Boolean(item)),
      epicId: String(row.get('epicId') || ''),
      releaseId: String(row.get('releaseId') || ''),
      epic: parents.get(String(row.get('epicId') || '')) || null,
      release: releases.get(String(row.get('releaseId') || '')) || null,
      progress: kindOf(row) === 'task' ? null : progress.get(row.id || '') || { ...EMPTY_PROGRESS },
      errorRefs: readErrorRefs(row.get('errorRefs')),
      voteCount: linkedPosts.filter(post => !post.hidden).reduce((sum, post) => sum + post.voteCount, 0),
      lastModifiedBy: String(row.get('lastModifiedBy') || ''),
      lastModifiedSource: String(row.get('lastModifiedSource') || '') as BoardItem['lastModifiedSource'],
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
export async function listBoardItems(project: ParseObject, filter: { conversation?: string, feedbackPost?: string, kind?: BoardItemKind, epicId?: string, releaseId?: string } = {}): Promise<BoardItem[]> {
  const rows = await collectAll(() => {
    const query = new (useParse()).Query('BoardItem').equalTo('project', project)
    if (filter.conversation) query.equalTo('conversationIds', filter.conversation)
    if (filter.feedbackPost) query.equalTo('feedbackPostIds', filter.feedbackPost)
    // Rows from before epics and releases have no kind: they are cards.
    if (filter.kind === 'task') query.notEqualTo('kind', 'epic')
    else if (filter.kind) query.equalTo('kind', filter.kind)
    if (filter.epicId) query.equalTo('epicId', filter.epicId)
    if (filter.releaseId) query.equalTo('releaseId', filter.releaseId)
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
  for (const key of ['title', 'kind', 'description', 'publicDescription', 'status', 'rank', 'priority', 'labels', 'attachments', 'public'] as const) {
    if (values[key] !== undefined) row.set(key, values[key])
  }
  if (values.targetDate === null) row.unset('targetDate')
  else if (values.targetDate) row.set('targetDate', values.targetDate)
  if (values.estimate === null) row.unset('estimate')
  else if (values.estimate !== undefined) row.set('estimate', values.estimate)
}

/**
 * Point a card at its epic and release (by id or `#N`; '' clears), and keep the
 * kinds consistent: only a card has an epic, a release has no parent, and an
 * epic or release that still has cards cannot become anything else.
 */
async function setParents(project: ParseObject, row: ParseObject, values: BoardItemValues, before: BoardItemKind): Promise<void> {
  const kind = kindOf(row)
  if (values.kind !== undefined && values.kind !== before && before === 'epic' && row.id) {
    if (await new (useParse()).Query('BoardItem').equalTo('project', project).equalTo('epicId', row.id).first(MASTER)) badRequest([`Move the cards out of this ${before} before changing its kind`])
  }
  if (values.epicId) {
    if (!kindCanHave(kind, 'epic')) badRequest([`A ${kind} cannot belong to an epic`])
    const target = await findBoardItem(project, values.epicId)
    if (!target || kindOf(target) !== 'epic') throw createError({ statusCode: 404, statusMessage: 'Epic not found' })
    row.set('epicId', target.id)
  } else if (values.epicId === '' || (values.kind !== undefined && !kindCanHave(kind, 'epic'))) {
    row.unset('epicId')
  }
  // A release is a changelog release of this project: the board's cards point at it, nothing else.
  if (values.releaseId) {
    const target = await new (useParse()).Query('ChangelogRelease').equalTo('project', project).get(values.releaseId, MASTER).catch(() => undefined)
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Release not found' })
    row.set('releaseId', target.id)
  } else if (values.releaseId === '') {
    row.unset('releaseId')
  }
}

/** Frees the cards of a release that is being deleted: they stay on the board, with no release. */
export async function freeReleaseCards(project: ParseObject, releaseId: string): Promise<void> {
  const Parse = useParse()
  await eachBatch(() => new Parse.Query('BoardItem').equalTo('project', project).equalTo('releaseId', releaseId), (cards) => {
    for (const card of cards) card.unset('releaseId')
    return Parse.Object.saveAll(cards, MASTER)
  }, { keys: ['releaseId'] })
}

type LinkTarget = { kind: 'feedback', id: string, row: ParseObject } | { kind: 'conversation', id: string, row: ParseObject } | { kind: 'item', id: string, row: ParseObject }

/** An item of this project by its object id or `#N`; undefined for anything else. */
export async function findBoardItem(project: ParseObject, ref: string): Promise<ParseObject | undefined> {
  if (!ref) return undefined
  const Parse = useParse()
  const byId = await new Parse.Query('BoardItem').equalTo('project', project).equalTo('objectId', ref).first(MASTER)
  if (byId) return byId
  const number = parsePostRef(ref.replace(/^#/, ''))
  return number ? await new Parse.Query('BoardItem').equalTo('project', project).equalTo('number', number).first(MASTER) : undefined
}

/** A post (by id or `#N`), a conversation or another item in this project; 404 for anything else. */
async function resolveLinkTarget(project: ParseObject, kind: BoardLinkKind, rawId: string): Promise<LinkTarget> {
  const id = String(rawId || '').trim()
  if (kind === 'item') {
    const item = await findBoardItem(project, id)
    if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
    return { kind, id: item.id || '', row: item }
  }
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
  if (value === 'feedback' || value === 'conversation' || value === 'item') return value
  badRequest(['kind must be feedback, conversation or item'])
}

function readIdList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) badRequest([`${label} must be an array`])
  const ids = unique(value.map(v => String(v ?? '').trim()))
  if (ids.length > BOARD_LINKS_MAX) badRequest([`An item links at most ${BOARD_LINKS_MAX} ${label === 'feedbackPostIds' ? 'posts' : 'conversations'}`])
  return ids
}

/** Add or remove one link with $addToSet / $pull, so two operators linking at once both land. A related item is linked on both sides. */
async function applyLink(project: ParseObject, row: ParseObject, target: LinkTarget, linked: boolean, agent: ParseObject, source: ClientSource, trackHistory = true): Promise<void> {
  const field = LINK_FIELD[target.kind]
  const ids = stringList(row.get(field))
  if (target.kind === 'item' && target.id === row.id) badRequest(['An item cannot be related to itself'])
  if (linked === ids.includes(target.id)) return
  const full = ids.length >= BOARD_LINKS_MAX || (target.kind === 'item' && stringList(target.row.get(field)).length >= BOARD_LINKS_MAX)
  if (linked && full) badRequest([`An item links at most ${BOARD_LINKS_MAX} ${LINK_NOUN[target.kind]}`])
  const before = historySnapshot(row)
  if (linked) row.addUnique(field, target.id)
  else row.remove(field, target.id)
  if (trackHistory) markBoardItem(row, agent, source)
  await row.save(null, MASTER)
  if (trackHistory) await recordBoardItemHistory(project, row, agent, source, 'updated', historyChanges(before, row))
  if (target.kind === 'item') {
    const targetBefore = historySnapshot(target.row)
    if (linked) target.row.addUnique(field, row.id)
    else target.row.remove(field, row.id)
    if (trackHistory) markBoardItem(target.row, agent, source)
    await target.row.save(null, MASTER)
    if (trackHistory) await recordBoardItemHistory(project, target.row, agent, source, 'updated', historyChanges(targetBefore, target.row))
  }
  if (target.kind === 'conversation') {
    await appendEvent(target.row, { type: linked ? 'board.linked' : 'board.unlinked', itemId: row.id || '', number: row.get('number') ?? null, title: String(row.get('title') || '') }, agent)
  }
}

/**
 * Reads a create or update body. A description over the limit (a pasted log, say) is kept rather than refused: the
 * whole text is attached as description.txt and the field keeps its start and a note. The file is stored only once
 * the rest of the body has passed, so a refused request stores nothing. `current` is the item's attachments.
 */
async function readItemBody(project: ParseObject, agent: ParseObject, payload: unknown, board: BoardConfig, options: { create: boolean }, current: ItemAttachment[]): Promise<BoardItemValues> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const full = typeof raw.description === 'string' && raw.description.length > FEEDBACK_BODY_MAX_LENGTH ? raw.description : ''
  const { values, errors } = readBoardItemInput(full ? { ...raw, description: overflowedDescription(full) } : raw, board, options)
  const files = values.attachments ?? current
  if (full && files.length >= ITEM_ATTACHMENTS_MAX) errors.push(`description is longer than ${FEEDBACK_BODY_MAX_LENGTH} characters, and the item has no room left to attach it as ${BOARD_DESCRIPTION_FILE}`)
  if (errors.length) badRequest(errors)
  assertOwnAttachments(project, values.attachments)
  // The byte order mark keeps a text that starts with `#!` from reading as a script.
  if (full) values.attachments = [...files, await storeItemFile({ filename: BOARD_DESCRIPTION_FILE, data: Buffer.from(`\uFEFF${full}`) }, project.id || '', `agent-${agent.id}`)]
  return values
}

export async function createBoardItem(project: ParseObject, agent: ParseObject, payload: unknown, source: ClientSource = 'api'): Promise<ParseObject> {
  const board = getBoardConfig(project)
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const Parse = useParse()
  // An outbox (the native app sends what was made offline) retries until it gets an answer: the same
  // `clientId` returns the item it already made instead of a second one.
  // ponytail: two requests racing with one clientId can both create; the app sends one at a time.
  const clientId = typeof raw.clientId === 'string' ? raw.clientId.trim().slice(0, 100) : ''
  if (clientId) {
    const existing = await new Parse.Query('BoardItem').equalTo('project', project).equalTo('clientId', clientId).first(MASTER)
    if (existing) return existing as ParseObject
  }
  const values = await readItemBody(project, agent, raw, board, { create: true }, [])
  // Resolve the links first, so a bad one fails the request before anything is written.
  const targets: LinkTarget[] = []
  for (const id of readIdList(raw.feedbackPostIds, 'feedbackPostIds')) targets.push(await resolveLinkTarget(project, 'feedback', id))
  for (const id of readIdList(raw.conversationIds, 'conversationIds')) targets.push(await resolveLinkTarget(project, 'conversation', id))

  const row = new (Parse.Object.extend('BoardItem'))() as ParseObject
  row.set('project', project)
  if (clientId) row.set('clientId', clientId)
  row.set('description', '')
  row.set('publicDescription', '')
  row.set('status', defaultFeedbackStatus(board).key)
  // Milliseconds since the epoch: a new item lands at the bottom of its column without a query.
  row.set('rank', Date.now())
  row.set('priority', '')
  row.set('labels', [])
  row.set('feedbackPostIds', [])
  row.set('conversationIds', [])
  row.set('relatedItemIds', [])
  row.set('kind', 'task')
  applyValues(row, values)
  await setParents(project, row, values, 'task')
  if (values.assigneeId) await setAssignee(row, values.assigneeId)
  const { completedAt } = statusTransition(board, '', String(row.get('status')), undefined, new Date())
  if (completedAt) row.set('completedAt', completedAt)
  row.set('number', await allocateProjectNumber(project, 'boardItemSeq', 'BoardItem'))
  markBoardItem(row, agent, source)
  await row.save(null, MASTER)
  for (const target of targets) await applyLink(project, row, target, true, agent, source, false)
  const empty = Object.fromEntries(HISTORY_FIELDS.map(field => [field, null]))
  await recordBoardItemHistory(project, row, agent, source, 'created', historyChanges(empty, row))
  emitDomainEventLater(project, 'board.item.created', {
    itemId: row.id, number: row.get('number') ?? null, ...eventActor(agent, source),
    status: row.get('status'), kind: kindOf(row), priority: row.get('priority') || '', assigneeId: pointerId(row.get('assignee')), labels: stringList(row.get('labels'))
  })
  return row
}

/**
 * Edit an item. The first move into a done status stamps `completedAt`. With
 * the board's `syncFeedback` on, a change of status category moves every
 * linked post to the feedback board's first status of that category, through
 * the same path an admin edit takes — so followers get the usual emails.
 */
export async function updateBoardItem(project: ParseObject, agent: ParseObject, row: ParseObject, payload: unknown, source: ClientSource = 'api'): Promise<ParseObject> {
  const board = getBoardConfig(project)
  const values = await readItemBody(project, agent, payload, board, { create: false }, itemAttachments(row.get('attachments')))
  const before = historySnapshot(row)
  const from = String(row.get('status') || '')
  const kindBefore = kindOf(row)
  applyValues(row, values)
  await setParents(project, row, values, kindBefore)
  if (values.assigneeId !== undefined) await setAssignee(row, values.assigneeId)
  const to = String(row.get('status') || '')
  const transition = statusTransition(board, from, to, row.get('completedAt') as Date | undefined, new Date())
  if (transition.completedAt) row.set('completedAt', transition.completedAt)
  const changes = historyChanges(before, row)
  if (changes.length) {
    markBoardItem(row, agent, source)
    await row.save(null, MASTER)
    await recordBoardItemHistory(project, row, agent, source, 'updated', changes)
  }
  const eventBase = { itemId: row.id, number: row.get('number') ?? null, ...eventActor(agent, source) }
  if (transition.changed) emitDomainEventLater(project, 'board.item.status_changed', { ...eventBase, from, to })
  const assigned = changes.find(change => change.field === 'assignee')
  if (assigned) emitDomainEventLater(project, 'board.item.assigned', { ...eventBase, from: assigned.from, to: assigned.to })
  const updated = changes.filter(change => UPDATED_EVENT_FIELDS.has(change.field))
  if (updated.length) emitDomainEventLater(project, 'board.item.updated', { ...eventBase, changes: updated })

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
export async function linkBoardItem(project: ParseObject, agent: ParseObject, row: ParseObject, kind: BoardLinkKind, id: string, linked: boolean, source: ClientSource = 'api'): Promise<ParseObject> {
  let target: LinkTarget
  try {
    target = await resolveLinkTarget(project, kind, id)
  } catch (error) {
    // Unlinking something deleted since: drop the stale id as stored.
    const field = LINK_FIELD[kind]
    if (linked || !stringList(row.get(field)).includes(id)) throw error
    const before = historySnapshot(row)
    row.remove(field, id)
    markBoardItem(row, agent, source)
    await row.save(null, MASTER)
    await recordBoardItemHistory(project, row, agent, source, 'updated', historyChanges(before, row))
    return await new (useParse()).Query('BoardItem').get(row.id || '', MASTER)
  }
  await applyLink(project, row, target, linked, agent, source)
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
  const Parse = useParse()
  await eachBatch(() => new Parse.Query('BoardItemComment').equalTo('item', row), comments => Parse.Object.destroyAll(comments, MASTER), { keys: ['objectId'] })
  // Deleting an epic frees its cards; it never deletes them.
  await eachBatch(() => new Parse.Query('BoardItem').equalTo('epicId', row.id || ''), (cards) => {
    for (const card of cards) card.unset('epicId')
    return Parse.Object.saveAll(cards, MASTER)
  }, { keys: ['epicId'] })
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
