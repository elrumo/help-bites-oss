// Vocabulary and limits shared by the API, the admin panel and the embed.
// One copy, imported by both sides, so client and server cannot drift.

export const MESSAGE_BODY_MAX_LENGTH = 8000
export const MESSAGE_SUBJECT_MAX_LENGTH = 200
export const CONTEXT_LABEL_MAX_LENGTH = 200

export const MESSAGE_SENDERS = ['user', 'agent'] as const
export type MessageSender = typeof MESSAGE_SENDERS[number]

export const MESSAGE_VISIBILITY = ['public', 'internal'] as const
export type MessageVisibility = typeof MESSAGE_VISIBILITY[number]
export const MESSAGE_KINDS = ['message', 'event'] as const
export type MessageKind = typeof MESSAGE_KINDS[number]

// Kept for existing support clients. Other conversation types define their
// statuses in ConversationType rows.
export const CONVERSATION_STATUSES = ['open', 'done'] as const
export type ConversationStatus = string
export const STATUS_CATEGORIES = ['open', 'pending', 'resolved', 'closed'] as const
export type StatusCategory = typeof STATUS_CATEGORIES[number]
export const CONVERSATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type ConversationPriority = typeof CONVERSATION_PRIORITIES[number]

export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024
export const ATTACHMENT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const MAX_ATTACHMENTS_PER_MESSAGE = 4

/** The six Messages tapbacks. A closed set keeps the bar short and the pills tidy. */
export const MESSAGE_REACTION_EMOJIS = ['❤️', '👍', '👎', '😆', '❗', '❓'] as const
export type MessageReactionEmoji = typeof MESSAGE_REACTION_EMOJIS[number]

/** What a conversation or message is about, as the host app describes it. */
export type Context = {
  type: string
  id: string
  label: string
  url?: string
  thumbnailUrl?: string
}

/** A frozen reference to the thing a ticket is about. `Context` remains as a
 * compatibility alias for existing embeds and message-level context cards. */
export type SubjectRef = Context & { ownerId?: string, ownerLabel?: string }

export type ConversationStatusDefinition = {
  key: string
  label: string
  category: StatusCategory
  isDefault?: boolean
  isTerminal?: boolean
  reopenTo?: string
}
export type ConversationField = {
  key: string
  label: string
  type: 'text' | 'longtext' | 'select' | 'url' | 'number' | 'bool'
  required?: boolean
  options?: string[]
  private?: boolean
  editableBy?: 'user' | 'agent' | 'none'
}
export type ConversationAction = { key: string, label: string, confirm?: string, destructive?: boolean, statusAfter?: string, requiresNote?: boolean }
export type ConversationType = {
  id?: string
  projectId?: string
  key: string
  name: string
  description: string
  icon: string
  statuses: ConversationStatusDefinition[]
  fields: ConversationField[]
  actions: ConversationAction[]
  assignable: boolean
  userCanReopen: boolean
  defaultPriority: ConversationPriority
}

export type Attachment = {
  url: string
  mime: string
  size: number
}

/** One tapback on a message. `actor` is stable per reactor ('user' or 'agent:<id>'). */
export type MessageReaction = {
  emoji: MessageReactionEmoji
  actor: string
  side: MessageSender
  actorName: string
  at: string
}

export type Message = {
  id: string
  conversationId: string
  sender: MessageSender
  senderName: string
  body: string
  attachments: Attachment[]
  reactions: MessageReaction[]
  context: Context | null
  replyToId: string
  clientId: string
  visibility: MessageVisibility
  kind: MessageKind
  event?: Record<string, unknown>
  /** Set when an AI SupportAgent generated this reply; empty for human/user messages. */
  supportAgentId?: string
  createdAt: string
  /** Only on messages this client is sending right now; see useChatOutbox. */
  delivery?: 'pending' | 'failed'
  deliveryError?: string
}

export type Conversation = {
  id: string
  projectId: string
  endUserId: string
  /** The assistant handling this conversation (the one the developer chose); '' when none. */
  assistantId: string
  subject: string
  status: ConversationStatus
  statusCategory: StatusCategory
  type: string
  priority: ConversationPriority
  assigneeId: string
  assignedAt: string | null
  tags: string[]
  fields: Record<string, unknown>
  subjectRef: SubjectRef | null
  reopenedAt: string | null
  closedAt: string | null
  doneAt: string | null
  context: Context | null
  lastMessageAt: string | null
  lastMessagePreview: string
  lastMessageFrom: MessageSender | ''
  unreadByAgent: number
  unreadByUser: number
  userReadAt: string | null
  agentReadAt: string | null
  /** Set while the team has archived it: hidden from the inbox queue, kept for history. */
  archivedAt: string | null
  createdAt: string
}

export function isReactionEmoji(value: unknown): value is MessageReactionEmoji {
  return (MESSAGE_REACTION_EMOJIS as readonly string[]).includes(String(value))
}

/** Keeps only well-formed tapbacks; anything stale or foreign is dropped. */
export function normalizeReactions(value: unknown): MessageReaction[] {
  if (!Array.isArray(value)) return []
  const out: MessageReaction[] = []
  for (const item of value) {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const emoji = String(raw.emoji || '')
    const actor = clampText(raw.actor, 60)
    if (!isReactionEmoji(emoji) || !actor) continue
    out.push({
      emoji,
      actor,
      side: raw.side === 'agent' ? 'agent' : 'user',
      actorName: clampText(raw.actorName, 120),
      at: typeof raw.at === 'string' ? raw.at : ''
    })
  }
  return out
}

/** Pick the same emoji again to take it back; one tapback per emoji per reactor. */
export function toggleReactions(reactions: MessageReaction[], emoji: MessageReactionEmoji, actor: { actor: string, side: MessageSender, actorName: string }, at: string): MessageReaction[] {
  const mine = (r: MessageReaction) => r.emoji === emoji && r.actor === actor.actor
  if (reactions.some(mine)) return reactions.filter(r => !mine(r))
  return [...reactions, { emoji, actor: actor.actor, side: actor.side, actorName: actor.actorName, at }]
}

export function clampText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

/** Short single-line preview for thread lists. */
export function messagePreview(body: unknown, maxLength = 140): string {
  const flat = String(body || '').replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength - 1).trimEnd()}…`
}

/** Only http(s) survives; anything else is dropped rather than coerced. */
export function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

/** Validate a host-supplied context. Returns null when there is nothing usable. */
export function normalizeContext(value: unknown): Context | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const type = clampText(raw.type, 40)
  const id = clampText(raw.id, 200)
  const label = clampText(raw.label, CONTEXT_LABEL_MAX_LENGTH)
  if (!type && !id && !label) return null
  const context: Context = { type, id, label: label || id || type }
  const url = safeHttpUrl(raw.url)
  const thumbnailUrl = safeHttpUrl(raw.thumbnailUrl)
  if (url) context.url = url
  if (thumbnailUrl) context.thumbnailUrl = thumbnailUrl
  return context
}

export function normalizeSubjectRef(value: unknown): SubjectRef | null {
  const context = normalizeContext(value)
  if (!context) return null
  const raw = value as Record<string, unknown>
  const ownerId = clampText(raw.ownerId, 200)
  const ownerLabel = clampText(raw.ownerLabel, CONTEXT_LABEL_MAX_LENGTH)
  return { ...context, ...(ownerId ? { ownerId } : {}), ...(ownerLabel ? { ownerLabel } : {}) }
}

/** Normalizes values against the small, serializable per-type intake schema. */
export function validateFields(value: unknown, definitions: ConversationField[], actor: 'user' | 'agent' = 'user'): { values: Record<string, unknown>, errors: string[] } {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const values: Record<string, unknown> = {}
  const errors: string[] = []
  for (const field of definitions) {
    const canEdit = field.editableBy !== 'none' && (actor === 'agent' || field.editableBy !== 'agent') && !(actor === 'user' && field.private)
    const input = raw[field.key]
    if (input === undefined || !canEdit) {
      if (field.required && canEdit) errors.push(`${field.label || field.key} is required`)
      continue
    }
    let normalized: unknown = ''
    if (field.type === 'bool') {
      if (typeof input !== 'boolean') { errors.push(`${field.label || field.key} must be true or false`); continue }
      normalized = input
    } else if (field.type === 'number') {
      const number = typeof input === 'number' ? input : Number(input)
      if (!Number.isFinite(number)) { errors.push(`${field.label || field.key} must be a number`); continue }
      normalized = number
    } else if (field.type === 'url') {
      normalized = safeHttpUrl(input)
      if (input && !normalized) { errors.push(`${field.label || field.key} must be an http(s) URL`); continue }
    } else {
      normalized = clampText(input, field.type === 'longtext' ? MESSAGE_BODY_MAX_LENGTH : MESSAGE_SUBJECT_MAX_LENGTH)
      if (field.type === 'select' && normalized && !field.options?.includes(normalized as string)) { errors.push(`${field.label || field.key} is not an allowed option`); continue }
    }
    if (field.required && (normalized === '' || normalized === null)) errors.push(`${field.label || field.key} is required`)
    else if (normalized !== '') values[field.key] = normalized
  }
  return { values, errors }
}
