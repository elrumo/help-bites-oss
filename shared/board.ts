// Project boards: Linear-style items on a kanban, and the public roadmap they
// feed. Shared by the API, the panel and the embed. Statuses and labels reuse
// the feedback board's vocabulary (a status still means open, planned, active,
// done or closed), so the roadmap rule — planned, active and done show — is the
// same everywhere.

import { CONVERSATION_PRIORITIES, type ConversationPriority } from './support'
import { readItemAttachments, type ItemAttachment } from './itemAttachments'
import {
  DEFAULT_FEEDBACK_CONFIG,
  FEEDBACK_BODY_MAX_LENGTH,
  FEEDBACK_TITLE_MAX_LENGTH,
  feedbackStatusDefinition,
  normalizeFeedbackKey,
  readDate,
  validateFeedbackConfig,
  type FeedbackPostRef,
  type FeedbackStatusCategory,
  type FeedbackStatusDefinition,
  type FeedbackTagDefinition
} from './feedback'

/** Posts, conversations and other items, one item may link to. */
export const BOARD_LINKS_MAX = 50

/** The largest estimate an item takes, in points. */
export const BOARD_ESTIMATE_MAX = 1000

/**
 * What an item is: a card, or an epic that groups cards. A release is not an item: it is a changelog
 * release (`releaseId` points at one), so the board and the changelog share one list of releases.
 */
export const BOARD_ITEM_KINDS = ['task', 'epic'] as const
export type BoardItemKind = typeof BOARD_ITEM_KINDS[number]

export const BOARD_ROADMAP_LAYOUTS = ['columns', 'timeline', 'list'] as const
export type BoardRoadmapLayout = typeof BOARD_ROADMAP_LAYOUTS[number]

/** The categories the public roadmap shows; everything else stays private. */
export const ROADMAP_CATEGORIES: FeedbackStatusCategory[] = ['planned', 'active', 'done']

export type BoardRoadmapOptions = {
  layout: BoardRoadmapLayout
  /** Send each item's labels (and the label set) to the public roadmap. */
  showLabels: boolean
  /** Send each item's target date; the timeline layout always does. */
  showDates: boolean
}

/** Saved views a board keeps: the layout, grouping, order and filters, named. */
export const BOARD_VIEWS_MAX = 20
export const BOARD_VIEW_NAME_MAX = 40
export const BOARD_VIEW_LAYOUTS = ['kanban', 'list'] as const
export const BOARD_VIEW_GROUPS = ['status', 'epic', 'release'] as const
export const BOARD_VIEW_ORDERS = ['manual', 'newest', 'oldest', 'votes'] as const

/** Filters as a view stores them: '' is "any". `assignee` may be 'unassigned', `priority` 'none'. */
export type BoardViewFilters = { search: string, labels: string[], assignee: string, priority: string, kind: string, epic: string, release: string, roadmapOnly: boolean }

export type BoardSavedView = {
  id: string
  name: string
  layout: typeof BOARD_VIEW_LAYOUTS[number]
  group: typeof BOARD_VIEW_GROUPS[number]
  order: typeof BOARD_VIEW_ORDERS[number]
  filters: BoardViewFilters
}

export const EMPTY_BOARD_VIEW_FILTERS: BoardViewFilters = { search: '', labels: [], assignee: '', priority: '', kind: '', epic: '', release: '', roadmapOnly: false }

export type BoardConfig = {
  enabled: boolean
  statuses: FeedbackStatusDefinition[]
  labels: FeedbackTagDefinition[]
  /** Linked feedback posts follow an item's status category, emails and all. */
  syncFeedback: boolean
  roadmap: BoardRoadmapOptions
  /** Saved views, shared by everyone on the project. */
  views: BoardSavedView[]
}

export const DEFAULT_BOARD_STATUSES: FeedbackStatusDefinition[] = [
  { key: 'backlog', label: 'Backlog', category: 'open', color: 'neutral', isDefault: true },
  { key: 'planned', label: 'Planned', category: 'planned', color: 'warning' },
  { key: 'in-progress', label: 'In progress', category: 'active', color: 'info' },
  { key: 'done', label: 'Done', category: 'done', color: 'success' },
  { key: 'canceled', label: 'Canceled', category: 'closed', color: 'error' }
]

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  enabled: false,
  statuses: DEFAULT_BOARD_STATUSES,
  labels: [],
  syncFeedback: false,
  roadmap: { layout: 'columns', showLabels: false, showDates: false },
  views: []
}

// ---- wire types -------------------------------------------------------------

export type BoardItemPriority = '' | ConversationPriority

/** An error from the project's tracker that this item was filed from (POST /v1/admin/errors/:id/board). */
export type BoardErrorRef = { provider: string, issueId: string, linkId: string, title: string, url: string }

/** An item files at most this many errors (the same bug reported twice is merged by hand). */
export const BOARD_ERROR_REFS_MAX = 20

/** What identifies a tracker issue across rows: the same key the error's conversation uses. */
export function errorRefKey(provider: string, issueId: string): string {
  return `${provider}:${issueId}`
}

/** Stored refs, leniently: anything malformed is dropped. */
export function readErrorRefs(value: unknown): BoardErrorRef[] {
  if (!Array.isArray(value)) return []
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  return value.flatMap((entry) => {
    const raw = record(entry)
    const ref = { provider: text(raw.provider, 40), issueId: text(raw.issueId, 100), linkId: text(raw.linkId, 40), title: text(raw.title, 200), url: text(raw.url, 1000) }
    return ref.provider && ref.issueId ? [ref] : []
  }).slice(0, BOARD_ERROR_REFS_MAX)
}

export type BoardLinkedPost = FeedbackPostRef & { voteCount: number, hidden: boolean }
export type BoardLinkedConversation = { id: string, subject: string, status: string, endUserName: string }
/** Another item of the same board that this one is related to. */
export type BoardRelatedItem = { id: string, number: number | null, title: string, status: string }
/** How far an epic or release is: its cards, and those in a done status; the same in estimate points. */
export type BoardProgress = { total: number, done: number, estimateTotal: number, estimateDone: number }
export type BoardItemHistoryChange = { field: string, from: unknown, to: unknown }
export type BoardItemHistory = {
  id: string
  itemId: string
  itemNumber: number | null
  itemTitle: string
  actorId: string
  actorName: string
  source: 'web' | 'app' | 'api' | 'mcp'
  action: 'created' | 'updated'
  changes: BoardItemHistoryChange[]
  createdAt: string
}
export type BoardItemComment = {
  id: string
  itemId: string
  body: string
  attachments: ItemAttachment[]
  parentId: string | null
  replyToId: string | null
  actorId: string
  actorName: string
  /** The displayed author: the operator, or the MCP client for assistant comments. */
  authorName: string
  authorType: 'operator' | 'assistant'
  source: 'web' | 'app' | 'api' | 'mcp'
  createdAt: string
}

/** An item as the panel (and admin keys) see it. */
export type BoardItem = {
  id: string
  projectId: string
  number: number | null
  title: string
  kind: BoardItemKind
  /** Internal Markdown. Never public. */
  description: string
  /** The only text the roadmap shows. */
  publicDescription: string
  status: string
  statusCategory: FeedbackStatusCategory
  rank: number
  priority: BoardItemPriority
  assigneeId: string
  labels: string[]
  attachments: ItemAttachment[]
  targetDate: string | null
  /** Effort in points; null when nobody sized it. */
  estimate: number | null
  public: boolean
  feedbackPostIds: string[]
  conversationIds: string[]
  /** Related items, symmetric: linking A to B also links B to A. */
  relatedItemIds: string[]
  related: BoardRelatedItem[]
  /** The epic and the release a card (or an epic) belongs to; '' for none. A release is a changelog release, its `title` its version. */
  epicId: string
  releaseId: string
  epic: BoardRelatedItem | null
  release: BoardRelatedItem | null
  /** Set on an epic or a release: its cards. Null on a plain card. */
  progress: BoardProgress | null
  /** Errors from the tracker this item was filed from; empty for an ordinary item. */
  errorRefs: BoardErrorRef[]
  /** Σ of the linked, non-hidden posts' votes. */
  voteCount: number
  lastModifiedBy: string
  lastModifiedSource: 'web' | 'app' | 'api' | 'mcp' | ''
  /** Linked posts that still exist, hidden ones included (flagged). */
  posts: BoardLinkedPost[]
  conversations: BoardLinkedConversation[]
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type RoadmapPost = FeedbackPostRef & { voteCount: number, hasVoted?: boolean }

/** An item as the public roadmap sees it: an allow-list, nothing internal. */
export type RoadmapItem = {
  id: string
  title: string
  /** The item's `publicDescription`. */
  description: string
  status: string
  statusCategory: FeedbackStatusCategory
  voteCount: number
  posts: RoadmapPost[]
  /** Only when the board shows labels. */
  labels?: string[]
  /** Only when the board shows dates, or lays the roadmap out as a timeline. */
  targetDate?: string | null
  completedAt: string | null
  updatedAt: string
}

export type RoadmapResponse = {
  options: BoardRoadmapOptions
  /** Planned, active and done statuses only. */
  statuses: FeedbackStatusDefinition[]
  labels?: FeedbackTagDefinition[]
  items: RoadmapItem[]
}

// ---- config -----------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
}

function isLayout(value: unknown): value is BoardRoadmapLayout {
  return (BOARD_ROADMAP_LAYOUTS as readonly string[]).includes(String(value))
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T, label: string, errors: string[]): T {
  if (value === undefined || value === null || value === '') return fallback
  if ((list as readonly string[]).includes(String(value))) return value as T
  errors.push(`${label} must be one of ${list.join(', ')}`)
  return fallback
}

/** A whole list of saved views, as the API takes it (it replaces the stored list). */
export function readBoardViews(value: unknown, errors: string[]): BoardSavedView[] {
  if (!Array.isArray(value)) { errors.push('views must be an array'); return [] }
  if (value.length > BOARD_VIEWS_MAX) { errors.push(`A board keeps at most ${BOARD_VIEWS_MAX} views`); return [] }
  const ids = new Set<string>()
  return value.flatMap((entry, index) => {
    const raw = record(entry)
    const label = `views[${index}]`
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!/^[a-z0-9-]{1,40}$/.test(id)) { errors.push(`${label}.id must be lowercase letters, digits and dashes (up to 40)`); return [] }
    if (ids.has(id)) { errors.push(`${label}.id is used twice`); return [] }
    if (!name || name.length > BOARD_VIEW_NAME_MAX) { errors.push(`${label}.name must be 1 to ${BOARD_VIEW_NAME_MAX} characters`); return [] }
    ids.add(id)
    const f = record(raw.filters)
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    return [{
      id,
      name,
      layout: oneOf(BOARD_VIEW_LAYOUTS, raw.layout, 'kanban', `${label}.layout`, errors),
      group: oneOf(BOARD_VIEW_GROUPS, raw.group, 'status', `${label}.group`, errors),
      order: oneOf(BOARD_VIEW_ORDERS, raw.order, 'manual', `${label}.order`, errors),
      filters: {
        search: text(f.search, 200),
        labels: Array.isArray(f.labels) ? [...new Set(f.labels.map(l => text(l, 40)).filter(Boolean))].slice(0, 30) : [],
        assignee: text(f.assignee, 40),
        priority: text(f.priority, 10),
        kind: text(f.kind, 10),
        epic: text(f.epic, 40),
        release: text(f.release, 40),
        roadmapOnly: f.roadmapOnly === true
      }
    }]
  })
}

/**
 * Validate a (partial) board config on top of `base`. Statuses and labels go
 * through the feedback board's validation (labels are its tags); `roadmap`
 * merges key by key, so toggling one option never resends the others.
 */
export function validateBoardConfig(value: unknown, base: BoardConfig = DEFAULT_BOARD_CONFIG): { config: BoardConfig, errors: string[] } {
  const raw = record(value)
  const lists = validateFeedbackConfig(
    { ...(raw.statuses !== undefined ? { statuses: raw.statuses } : {}), ...(raw.labels !== undefined ? { tags: raw.labels } : {}) },
    { ...DEFAULT_FEEDBACK_CONFIG, statuses: base.statuses, tags: base.labels }
  )
  const errors = lists.errors.map(error => error.replace(/^tags\b/, 'labels').replace('Every tag needs', 'Every label needs'))
  const config: BoardConfig = { ...base, statuses: lists.config.statuses, labels: lists.config.tags, roadmap: { ...base.roadmap }, views: [...(base.views || [])] }

  if (raw.enabled !== undefined) config.enabled = Boolean(raw.enabled)
  if (raw.syncFeedback !== undefined) config.syncFeedback = Boolean(raw.syncFeedback)
  if (raw.views !== undefined) config.views = readBoardViews(raw.views, errors)
  if (raw.roadmap !== undefined) {
    if (!raw.roadmap || typeof raw.roadmap !== 'object' || Array.isArray(raw.roadmap)) errors.push('roadmap must be an object')
    else {
      const roadmap = raw.roadmap as Record<string, unknown>
      if (roadmap.layout !== undefined) {
        if (isLayout(roadmap.layout)) config.roadmap.layout = roadmap.layout
        else errors.push(`roadmap.layout must be one of ${BOARD_ROADMAP_LAYOUTS.join(', ')}`)
      }
      if (roadmap.showLabels !== undefined) config.roadmap.showLabels = Boolean(roadmap.showLabels)
      if (roadmap.showDates !== undefined) config.roadmap.showDates = Boolean(roadmap.showDates)
    }
  }
  return { config, errors }
}

/** Read a stored config leniently: whatever is valid wins, the rest falls back to defaults. */
export function normalizeBoardConfig(value: unknown): BoardConfig {
  const { config } = validateBoardConfig(value)
  if (!config.statuses.length) config.statuses = DEFAULT_BOARD_STATUSES
  return config
}

// ---- item input -------------------------------------------------------------

export type BoardItemValues = Partial<{
  title: string
  kind: BoardItemKind
  /** An epic's id or `#N`; '' clears it. Checked against the board's epics by the server. */
  epicId: string
  /** A changelog release's id; '' clears it. Checked against the project's releases by the server. */
  releaseId: string
  description: string
  publicDescription: string
  status: string
  rank: number
  priority: BoardItemPriority
  /** '' clears the assignee. Checked against the agents by the server. */
  assigneeId: string
  labels: string[]
  attachments: ItemAttachment[]
  targetDate: Date | null
  /** null clears it. */
  estimate: number | null
  public: boolean
}>

function longText(raw: unknown, label: string, errors: string[]): string | undefined {
  if (raw === null) return ''
  if (typeof raw !== 'string') { errors.push(`${label} must be a string`); return undefined }
  if (raw.length > FEEDBACK_BODY_MAX_LENGTH) { errors.push(`${label} is longer than ${FEEDBACK_BODY_MAX_LENGTH} characters`); return undefined }
  return raw.trim()
}

/** Read a create/update body for a board item. Anything present but malformed is reported. */
export function readBoardItemInput(payload: unknown, config: Pick<BoardConfig, 'statuses' | 'labels'>, options: { create: boolean }): { values: BoardItemValues, errors: string[] } {
  const raw = record(payload)
  const values: BoardItemValues = {}
  const errors: string[] = []
  const has = (key: string) => raw[key] !== undefined

  if (has('title') || options.create) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!title) errors.push('A title is required')
    else if (title.length > FEEDBACK_TITLE_MAX_LENGTH) errors.push(`The title is longer than ${FEEDBACK_TITLE_MAX_LENGTH} characters`)
    else values.title = title
  }
  if (has('kind')) {
    if ((BOARD_ITEM_KINDS as readonly unknown[]).includes(raw.kind)) values.kind = raw.kind as BoardItemKind
    else errors.push(`kind must be one of ${BOARD_ITEM_KINDS.join(', ')}`)
  }
  for (const key of ['epicId', 'releaseId'] as const) {
    if (!has(key)) continue
    if (raw[key] !== null && typeof raw[key] !== 'string') errors.push(`${key} must be a string`)
    else values[key] = String(raw[key] || '').trim().slice(0, 40)
  }
  for (const key of ['description', 'publicDescription'] as const) {
    if (!has(key)) continue
    const text = longText(raw[key], key, errors)
    if (text !== undefined) values[key] = text
  }
  if (has('status')) {
    const status = normalizeFeedbackKey(raw.status)
    if (!feedbackStatusDefinition(config, status)) errors.push(`Unknown status: ${status}`)
    else values.status = status
  }
  if (has('priority')) {
    const priority = raw.priority === null ? '' : String(raw.priority)
    if (priority && !(CONVERSATION_PRIORITIES as readonly string[]).includes(priority)) errors.push(`priority must be one of ${CONVERSATION_PRIORITIES.join(', ')}, or empty`)
    else values.priority = priority as BoardItemPriority
  }
  if (has('labels')) {
    if (raw.labels !== null && !Array.isArray(raw.labels)) errors.push('labels must be an array')
    else {
      const labels = [...new Set((raw.labels as unknown[] | null || []).map(normalizeFeedbackKey).filter(Boolean))]
      const unknown = labels.filter(label => !config.labels.some(l => l.key === label))
      if (unknown.length) errors.push(`Unknown label: ${unknown.join(', ')}`)
      else values.labels = labels
    }
  }
  if (has('targetDate')) {
    const date = readDate(raw.targetDate, 'targetDate', errors)
    if (date !== undefined) values.targetDate = date
  }
  if (has('estimate')) {
    // A numeric string is read as a number: MCP clients clear a field with an empty string.
    const estimate = typeof raw.estimate === 'string' && raw.estimate.trim() ? Number(raw.estimate) : raw.estimate
    if (estimate === null || (typeof estimate === 'string' && !estimate.trim())) values.estimate = null
    else if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate < 0 || estimate > BOARD_ESTIMATE_MAX) errors.push(`estimate must be a number from 0 to ${BOARD_ESTIMATE_MAX}, or null`)
    else values.estimate = Math.round(estimate * 100) / 100
  }
  if (has('public')) values.public = Boolean(raw.public)
  else if (options.create) values.public = false
  if (has('rank')) {
    const rank = typeof raw.rank === 'number' ? raw.rank : Number.NaN
    if (!Number.isFinite(rank)) errors.push('rank must be a finite number')
    else values.rank = rank
  }
  if (has('assigneeId')) {
    if (raw.assigneeId !== null && typeof raw.assigneeId !== 'string') errors.push('assigneeId must be a string')
    else values.assigneeId = String(raw.assigneeId || '').trim().slice(0, 40)
  }
  if (has('attachments')) {
    const attachments = readItemAttachments(raw.attachments, errors)
    if (attachments) values.attachments = attachments
  }
  return { values, errors }
}

// ---- ordering ---------------------------------------------------------------

/**
 * A rank between two neighbours: their midpoint, or one step past the only
 * neighbour there is. An empty column gets 0.
 * ponytail: about 50 halvings of the same gap exhaust float precision; rebalance
 * the column (renumber its ranks 1, 2, 3…) if that ever happens.
 */
export function rankBetween(before?: number | null, after?: number | null): number {
  const a = typeof before === 'number' && Number.isFinite(before) ? before : undefined
  const b = typeof after === 'number' && Number.isFinite(after) ? after : undefined
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return b! - 1
  if (b === undefined) return a + 1
  return (a + b) / 2
}

// ---- the public roadmap -----------------------------------------------------

type RoadmapSource = Pick<BoardItem, 'id' | 'title' | 'publicDescription' | 'status' | 'statusCategory' | 'labels' | 'targetDate' | 'completedAt' | 'updatedAt'>

/**
 * The public shape of an item: an allow-list, so a field added to BoardItem
 * never leaks by default. Hidden posts are dropped (and stop counting);
 * labels and dates only go out when the board says so.
 */
export function toRoadmapItem(item: RoadmapSource, posts: (RoadmapPost & { hidden?: boolean })[], options: BoardRoadmapOptions): RoadmapItem {
  const shown = posts.filter(post => !post.hidden).map(post => ({
    id: post.id,
    number: post.number,
    title: post.title,
    status: post.status,
    statusCategory: post.statusCategory,
    voteCount: post.voteCount,
    ...(post.hasVoted !== undefined ? { hasVoted: post.hasVoted } : {})
  }))
  const out: RoadmapItem = {
    id: item.id,
    title: item.title,
    description: item.publicDescription,
    status: item.status,
    statusCategory: item.statusCategory,
    voteCount: shown.reduce((sum, post) => sum + post.voteCount, 0),
    posts: shown,
    completedAt: item.completedAt,
    updatedAt: item.updatedAt
  }
  if (options.showLabels) out.labels = [...item.labels]
  if (options.showDates || options.layout === 'timeline') out.targetDate = item.targetDate
  return out
}

export type RoadmapGroup<T> = {
  key: string
  label: string
  /** Set for status groups (columns, list). */
  status?: FeedbackStatusDefinition
  items: T[]
}

function quarterOf(value: string | null | undefined): { key: string, label: string } | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // Target dates are calendar days stored at UTC midnight: read them in UTC.
  const year = date.getUTCFullYear()
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1
  return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` }
}

/**
 * Cards grouped the way a layout shows them: one group per status (in the
 * board's order, empty ones included) for `columns` and `list`; one group per
 * target quarter for `timeline`, soonest first, with undated cards last.
 * Works for board items and for the post-based roadmap alike.
 */
export function roadmapGroups<T extends { status: string, targetDate?: string | null }>(cards: T[], statuses: FeedbackStatusDefinition[], layout: BoardRoadmapLayout): RoadmapGroup<T>[] {
  if (layout !== 'timeline') {
    return statuses.map(status => ({ key: status.key, label: status.label, status, items: cards.filter(card => card.status === status.key) }))
  }
  const groups = new Map<string, RoadmapGroup<T>>()
  const undated: T[] = []
  const dated = [...cards].sort((a, b) => String(a.targetDate || '').localeCompare(String(b.targetDate || '')))
  for (const card of dated) {
    const quarter = quarterOf(card.targetDate)
    if (!quarter) { undated.push(card); continue }
    const group = groups.get(quarter.key) || { key: quarter.key, label: quarter.label, items: [] }
    group.items.push(card)
    groups.set(quarter.key, group)
  }
  const out = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
  if (undated.length) out.push({ key: 'none', label: 'No date', items: undated })
  return out
}

// ---- epics and releases -----------------------------------------------------

/** An epic holds cards; a release (a changelog release) holds cards and epics. */
export function kindCanHave(kind: BoardItemKind, parent: 'epic' | 'release'): boolean {
  return parent === 'epic' ? kind === 'task' : true
}
