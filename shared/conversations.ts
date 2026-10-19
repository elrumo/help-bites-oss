// Pure transcript helpers: Messages.app-style grouping and one-level reply
// threads. Derived from a flat message log, minus the
// conversation derivation — here conversations are real rows from the API.

import { messagePreview, type Conversation, type Message } from './support'

export interface MessageRun {
  key: string
  sender: string
  messages: Message[]
}

export interface MessageGroup {
  key: string
  /** First message in the group; the UI formats the separator label locally. */
  startedAt: string | null
  runs: MessageRun[]
}

/** A fresh timestamp once the thread has been quiet a while. */
export const MESSAGE_GROUP_GAP_MS = 60 * 60 * 1000

function startOfDayKey(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function timeOf(value: string | null): number {
  if (!value) return Number.NaN
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

/**
 * Split an oldest-first message list into timestamp groups, each holding runs
 * of consecutive same-sender messages. A new group starts on a calendar-day
 * change or a gap longer than `gapMs`; unparseable stamps never break on
 * their own.
 */
export function groupMessagesForDisplay(messages: Message[], gapMs = MESSAGE_GROUP_GAP_MS): MessageGroup[] {
  const groups: MessageGroup[] = []
  let previousAt = Number.NaN
  let previousDay = ''

  for (const message of messages || []) {
    if (!message) continue

    const at = timeOf(message.createdAt)
    const day = startOfDayKey(message.createdAt)
    const hasStamp = !Number.isNaN(at)

    const dayChanged = Boolean(day) && Boolean(previousDay) && day !== previousDay
    const longGap = hasStamp && !Number.isNaN(previousAt) && at - previousAt > gapMs
    const needsGroup = groups.length === 0 || dayChanged || longGap

    if (needsGroup) {
      groups.push({ key: `g${groups.length}-${message.id}`, startedAt: message.createdAt, runs: [] })
    }

    const group = groups[groups.length - 1]!
    const lastRun = group.runs[group.runs.length - 1]

    if (!lastRun || lastRun.sender !== message.sender) {
      group.runs.push({ key: `r-${message.id}`, sender: message.sender, messages: [message] })
    } else {
      lastRun.messages.push(message)
    }

    if (hasStamp) previousAt = at
    if (day) previousDay = day
  }

  return groups
}

export interface ThreadIndex {
  /** Message id → id of the thread it replies into; '' for a top-level message. */
  rootOf: Map<string, string>
  /** Root message id → its replies, in transcript order. */
  replies: Map<string, Message[]>
}

/**
 * One level deep on purpose: replying to a reply joins the original's thread.
 * A reply whose original is gone stands on its own as an ordinary message.
 */
export function buildThreads(messages: Message[]): ThreadIndex {
  const byId = new Map<string, Message>()
  for (const message of messages || []) {
    if (message) byId.set(message.id, message)
  }

  const rootOf = new Map<string, string>()
  const replies = new Map<string, Message[]>()

  for (const message of messages || []) {
    if (!message) continue

    // Bounded, and stopped by a self-reference, so a malformed import can never spin this.
    let root = ''
    let next = message.replyToId || ''
    for (let hops = 0; next && next !== message.id && hops < 8; hops++) {
      const parent = byId.get(next)
      if (!parent) break
      root = next
      next = parent.replyToId || ''
    }

    rootOf.set(message.id, root)
    if (root) {
      const list = replies.get(root) || []
      list.push(message)
      replies.set(root, list)
    }
  }

  return { rootOf, replies }
}

/** Who and what a reply answers, for the composer's "Replying to…" line. */
export function replyTarget(messages: Message[], rootId: string, ownSender: string): { id: string, name: string, preview: string } | null {
  const root = rootId ? (messages || []).find(message => message?.id === rootId) : undefined
  if (!root) return null
  return {
    id: root.id,
    name: root.sender === ownSender ? 'yourself' : (root.senderName || 'them'),
    preview: messagePreview(root.body, 80)
  }
}

export function sortByCreatedAt(a: Message, b: Message): number {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
}

export function eventLabel(message: Message): string {
  const event = message.event || {}
  if (event.type === 'created') return 'Ticket created'
  if (event.type === 'status.changed') return `Status changed to ${String(event.to || '')}`
  if (event.type === 'assigned') return event.assignee ? `Assigned to ${String(event.assignee)}` : 'Assignment cleared'
  if (event.type === 'action.performed') return `${String(event.actionKey || 'Host action')} · ${String(event.result || 'pending')}`
  if (event.type === 'board.linked' || event.type === 'board.unlinked') {
    const item = `${event.number ? `#${String(event.number)} ` : ''}${String(event.title || 'an item')}`
    return event.type === 'board.linked' ? `Linked to board item ${item}` : `Unlinked from board item ${item}`
  }
  if (event.type === 'changelog.linked' || event.type === 'changelog.unlinked') {
    const entry = `${event.number ? `#${String(event.number)} ` : ''}${String(event.title || 'an entry')}`
    return event.type === 'changelog.linked' ? `Linked to changelog entry ${entry}` : `Unlinked from changelog entry ${entry}`
  }
  return 'Ticket updated'
}

export interface ConversationTextMeta {
  customer?: string
  project?: string
}

// Plain text for pasting into an LLM: a short header of facts, then one block per
// message in order, with the speaker made explicit and nothing but text in it.
export function conversationToText(conversation: Conversation, messages: Message[], meta: ConversationTextMeta = {}): string {
  const stamp = (iso: string) => String(iso || '').slice(0, 16).replace('T', ' ') + ' UTC'
  const byId = new Map(messages.map(message => [message.id, message]))
  const header = [
    `Support conversation: ${conversation.subject || conversation.context?.label || 'Untitled'}`,
    meta.project && `Project: ${meta.project}`,
    meta.customer && `Customer: ${meta.customer}`,
    `Status: ${conversation.status}`,
    conversation.type && `Type: ${conversation.type}`,
    `Priority: ${conversation.priority}`,
    conversation.tags?.length && `Tags: ${conversation.tags.join(', ')}`,
    conversation.context?.label && `About: ${conversation.context.label}${conversation.context.url ? ` (${conversation.context.url})` : ''}`,
    `Started: ${stamp(conversation.createdAt)}`
  ].filter(Boolean)

  const blocks = [...messages].filter(message => !message.delivery).sort(sortByCreatedAt).map((message) => {
    const time = stamp(message.createdAt)
    if (message.kind === 'event') return `[${time}] (system) ${eventLabel(message)}`
    const role = message.sender === 'user' ? 'Customer' : message.supportAgentId ? 'AI assistant' : 'Support agent'
    const label = `${role}${message.senderName ? ` (${message.senderName})` : ''}${message.visibility === 'internal' ? ' [internal note, not visible to the customer]' : ''}`
    const parent = message.replyToId ? byId.get(message.replyToId) : null
    const lines = [`[${time}] ${label}${parent ? ` replying to ${parent.senderName || parent.sender}` : ''}:`, message.body]
    if (message.context?.label) lines.push(`Context: ${message.context.label}${message.context.url ? ` (${message.context.url})` : ''}`)
    for (const attachment of message.attachments || []) lines.push(`Attachment: ${attachment.url} (${attachment.mime})`)
    return lines.join('\n')
  })

  return `${header.join('\n')}\n\n---\n\n${blocks.join('\n\n')}\n`
}
