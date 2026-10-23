import { createError } from 'h3'
import {
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_SUBJECT_MAX_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  ATTACHMENT_MIME_TYPES,
  clampText,
  messagePreview,
  normalizeContext,
  normalizeReactions,
  normalizeSubjectRef,
  safeHttpUrl,
  toggleReactions,
  validateFields,
  type Attachment,
  type Context,
  type Conversation,
  type Message,
  type MessageReaction,
  type MessageReactionEmoji,
  type MessageSender,
  type MessageVisibility,
  type SubjectRef,
  type ConversationField
} from '#shared/support'
import { defaultStatus, getConversationType, publicFields, statusDefinition } from './conversationTypes'
import type { SupportEvent } from './events'

// Every write to Conversation / Message goes through here, so the inbox
// summary on the conversation row (last message, unread counters, status) is
// maintained in exactly one place.

export const PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

/** The page size a request's `limit` actually gets: default, whole number, capped. */
export function pageSize(limit: unknown): number {
  return Math.min(Math.max(Math.floor(Number(limit)) || PAGE_SIZE, 1), MAX_PAGE_SIZE)
}

/** A full page means there may be more. `size` must be the size that was queried, i.e. `pageSize(limit)`. */
export function pageHasMore(count: number, size: number): boolean {
  return count >= size
}

// ---- serializers ----------------------------------------------------------

export function serializeConversation(row: ParseObject): Conversation {
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    endUserId: pointerId(row.get('endUser')),
    assistantId: String(row.get('assistantId') || ''),
    subject: String(row.get('subject') || ''),
    status: String(row.get('status') || 'open'),
    statusCategory: ['open', 'pending', 'resolved', 'closed'].includes(row.get('statusCategory')) ? row.get('statusCategory') : (row.get('status') === 'done' ? 'resolved' : 'open'),
    type: String(row.get('type') || 'support'),
    priority: ['low', 'normal', 'high', 'urgent'].includes(row.get('priority')) ? row.get('priority') : 'normal',
    assigneeId: pointerId(row.get('assignee')),
    assignedAt: iso(row.get('assignedAt')),
    tags: Array.isArray(row.get('tags')) ? (row.get('tags') as unknown[]).filter((tag): tag is string => typeof tag === 'string') : [],
    fields: row.get('fields') && typeof row.get('fields') === 'object' ? row.get('fields') : {},
    subjectRef: (row.get('subjectRef') as SubjectRef) || (row.get('context') as SubjectRef) || null,
    reopenedAt: iso(row.get('reopenedAt')),
    closedAt: iso(row.get('closedAt')),
    doneAt: iso(row.get('doneAt')),
    context: (row.get('context') as Context) || null,
    lastMessageAt: iso(row.get('lastMessageAt')),
    lastMessagePreview: String(row.get('lastMessagePreview') || ''),
    lastMessageFrom: (row.get('lastMessageFrom') as MessageSender) || '',
    unreadByAgent: Number(row.get('unreadByAgent') || 0),
    unreadByUser: Number(row.get('unreadByUser') || 0),
    userReadAt: iso(row.get('userReadAt')),
    agentReadAt: iso(row.get('agentReadAt')),
    archivedAt: iso(row.get('archivedAt')),
    channel: row.get('channel') === 'email' ? 'email' : 'widget',
    feedbackPostIds: Array.isArray(row.get('feedbackPostIds')) ? (row.get('feedbackPostIds') as unknown[]).filter((id): id is string => typeof id === 'string') : [],
    createdAt: iso(row.createdAt) || ''
  }
}

/** A conversation as its end user sees it: triage (priority, assignment, tags, linked feedback) is the team's business. */
export type EndUserConversation = Omit<Conversation, 'priority' | 'assigneeId' | 'assignedAt' | 'tags' | 'feedbackPostIds'>

export function withoutTriage(conversation: Conversation): EndUserConversation {
  const { priority: _priority, assigneeId: _assigneeId, assignedAt: _assignedAt, tags: _tags, feedbackPostIds: _feedbackPostIds, ...rest } = conversation
  return rest
}

/** End-user responses never include fields marked private on the type. */
export async function serializeConversationForEndUser(row: ParseObject): Promise<EndUserConversation> {
  const conversation = serializeConversation(row)
  return withoutTriage({ ...conversation, fields: publicFields(conversation.fields, await getConversationType(row.get('project'), conversation.type)) })
}

/** The end-user stream's view of a live event: the shared payload is the agents' one. */
export function endUserEvent(event: SupportEvent) {
  return { ...event, conversation: withoutTriage(event.conversation) }
}

// SSE is a shared transport for agents and users. Field values are fetched with
// the conversation detail instead of being copied into a broadcast payload.
function serializeConversationEvent(row: ParseObject): Conversation {
  return { ...serializeConversation(row), fields: {} }
}

export function serializeMessage(row: ParseObject): Message {
  return {
    id: row.id || '',
    conversationId: pointerId(row.get('conversation')),
    sender: row.get('sender') === 'agent' ? 'agent' : 'user',
    senderName: String(row.get('senderName') || ''),
    body: String(row.get('body') || ''),
    attachments: Array.isArray(row.get('attachments')) ? row.get('attachments') : [],
    reactions: normalizeReactions(row.get('reactions')),
    context: (row.get('context') as Context) || null,
    replyToId: String(row.get('replyToId') || ''),
    clientId: String(row.get('clientId') || ''),
    visibility: row.get('visibility') === 'internal' ? 'internal' : 'public',
    kind: row.get('kind') === 'event' ? 'event' : 'message',
    event: row.get('event') && typeof row.get('event') === 'object' ? row.get('event') : undefined,
    supportAgentId: pointerId(row.get('supportAgent')),
    createdAt: iso(row.createdAt) || ''
  }
}

// ---- input validation -----------------------------------------------------

export type MessageInput = {
  body: string
  replyToId: string
  clientId: string
  attachments: Attachment[]
  context: Context | null
  /** Set by server code only (readMessageInput never reads it): the Message-ID of the email this message is. */
  emailMessageId?: string
}

/** Attachments must be ours and belong to this project; anything else is dropped. */
export function normalizeAttachments(value: unknown, projectId: string): Attachment[] {
  if (!Array.isArray(value)) return []
  const base = attachmentPrefix(projectId)
  const out: Attachment[] = []
  for (const item of value.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    const raw = item as Record<string, unknown>
    const url = safeHttpUrl(raw?.url)
    const mime = String(raw?.mime || '')
    if (!url || !url.startsWith(base) || !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime)) continue
    out.push({ url, mime, size: Math.max(0, Number(raw?.size) || 0) })
  }
  return out
}

export function attachmentPrefix(projectId: string): string {
  return `${String(process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')}/${projectId}/`
}

export function readMessageInput(payload: Record<string, unknown>, projectId: string): MessageInput {
  const body = clampText(payload?.body, MESSAGE_BODY_MAX_LENGTH)
  const attachments = normalizeAttachments(payload?.attachments, projectId)
  if (!body && !attachments.length) throw createError({ statusCode: 400, statusMessage: 'Message body is required' })
  return {
    body,
    replyToId: clampText(payload?.replyToId, 40),
    clientId: clampText(payload?.clientId, 80),
    attachments,
    context: normalizeContext(payload?.context)
  }
}

export function readSubject(payload: Record<string, unknown>): string {
  return clampText(payload?.subject, MESSAGE_SUBJECT_MAX_LENGTH)
}

// ---- write rules (pure) ---------------------------------------------------

export type ConversationState = Pick<Conversation, 'status' | 'unreadByAgent' | 'unreadByUser' | 'lastMessageAt' | 'lastMessagePreview' | 'lastMessageFrom' | 'context'>

/** What a new message does to its conversation's summary. */
export function nextStateAfterMessage(prev: ConversationState, message: Pick<Message, 'sender' | 'body' | 'createdAt' | 'context' | 'attachments'>, reopenStatus = 'open'): ConversationState {
  const preview = message.body ? messagePreview(message.body, 140) : (message.attachments?.length ? '📎 Attachment' : '')
  return {
    // A user writing into a done conversation reopens it; an agent reply does not.
    status: message.sender === 'user' ? reopenStatus : prev.status,
    unreadByAgent: message.sender === 'user' ? prev.unreadByAgent + 1 : prev.unreadByAgent,
    unreadByUser: message.sender === 'agent' ? prev.unreadByUser + 1 : prev.unreadByUser,
    lastMessageAt: message.createdAt,
    lastMessagePreview: preview,
    lastMessageFrom: message.sender,
    context: message.context || prev.context
  }
}

/** Summary after a delete, recomputed from what is left; null means the conversation is now empty. */
export function stateAfterDelete(
  prev: ConversationState,
  remaining: Pick<Message, 'sender' | 'body' | 'createdAt' | 'attachments'> | null,
  readAt: { userReadAt: string | null, agentReadAt: string | null },
  unreadAfter: (side: 'user' | 'agent') => number
): ConversationState {
  return {
    status: prev.status,
    unreadByAgent: unreadAfter('agent'),
    unreadByUser: unreadAfter('user'),
    lastMessageAt: remaining ? remaining.createdAt : null,
    lastMessagePreview: remaining ? (remaining.body ? messagePreview(remaining.body, 140) : (remaining.attachments?.length ? '📎 Attachment' : '')) : '',
    lastMessageFrom: remaining ? remaining.sender : '',
    context: prev.context
  }
}

// ---- Parse plumbing -------------------------------------------------------

function applyState(row: ParseObject, state: ConversationState): void {
  row.set('status', state.status)
  row.set('unreadByAgent', state.unreadByAgent)
  row.set('unreadByUser', state.unreadByUser)
  row.set('lastMessageAt', state.lastMessageAt ? new Date(state.lastMessageAt) : null)
  row.set('lastMessagePreview', state.lastMessagePreview)
  row.set('lastMessageFrom', state.lastMessageFrom)
  row.set('context', state.context)
  if (state.status === 'open') row.unset('doneAt')
}

export async function getConversation(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('Conversation').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }
}

export type ConversationInput = { type?: unknown, fields?: unknown, subjectRef?: unknown, idempotencyKey?: unknown, priority?: unknown, assistantId?: unknown }

/** Resolve the assistant the developer chose for this surface (by id or slug)
 *  to an id, requiring it to belong to this project; '' when none/unknown so
 *  creation never fails on a stale assistant reference. */
async function resolveAssistantId(project: ParseObject, raw: unknown): Promise<string> {
  const value = clampText(raw, 60)
  if (!value) return ''
  const Parse = useParse()
  const byId = await new Parse.Query('SupportAgent').equalTo('project', project).equalTo('objectId', value).first(MASTER).catch(() => null)
  const agent = byId || await new Parse.Query('SupportAgent').equalTo('project', project).equalTo('slug', value).first(MASTER).catch(() => null)
  return agent?.id || ''
}

export async function createConversation(project: ParseObject, endUser: ParseObject, subject: string, context: Context | null, input: ConversationInput = {}, actor: 'user' | 'agent' = 'user'): Promise<ParseObject> {
  const Parse = useParse()
  const type = await getConversationType(project, input.type)
  // Dedupe keys, priority and the built-in error preset belong to the server
  // side (host tickets, the error inbox, operators). From an end user they
  // would let one pre-claim a ticket or alert key and swallow the real one.
  const trusted = actor === 'agent'
  if (!trusted && type.key === 'error' && !type.id) throw createError({ statusCode: 400, statusMessage: 'Unknown conversation type: error' })
  const fields = validateConversationFields(input.fields, type.fields, actor)
  const initial = defaultStatus(type)
  const row = new (Parse.Object.extend('Conversation'))()
  row.set('project', project)
  row.set('endUser', endUser)
  row.set('subject', subject)
  row.set('type', type.key)
  row.set('status', initial.key)
  row.set('statusCategory', initial.category)
  row.set('priority', trusted && ['low', 'normal', 'high', 'urgent'].includes(String(input.priority)) ? input.priority : type.defaultPriority)
  row.set('context', context)
  row.set('subjectRef', normalizeSubjectRef(input.subjectRef) || context)
  row.set('fields', fields)
  const assistantId = await resolveAssistantId(project, input.assistantId)
  if (assistantId) row.set('assistantId', assistantId)
  const idempotencyKey = trusted ? clampText(input.idempotencyKey, 200) : ''
  if (idempotencyKey) row.set('idempotencyKey', idempotencyKey)
  row.set('unreadByAgent', 0)
  row.set('unreadByUser', 0)
  // Only conversations people start count against the plan; tickets, the error inbox and operators' own do not.
  if (actor === 'user') await reserveUsage(await projectWorkspaceId(project), 'conversations')
  await row.save(null, MASTER)
  void syncConversationForSearch(row)
  emitDomainEventLater(project, 'conversation.created', { conversationId: row.id, contact: { id: endUser.id, externalId: endUser.get('externalId') || '', email: endUser.get('email') || '' }, type: type.key })
  return row
}

export type AppendOptions = {
  conversation: ParseObject
  sender: MessageSender
  senderName: string
  agent?: ParseObject
  /** Set when an AI SupportAgent generated this reply (provenance + UI badge). */
  supportAgent?: ParseObject
  input: MessageInput
  visibility?: MessageVisibility
}

/** Append a message and update the conversation summary. Idempotent on `clientId`. */
export async function appendMessage({ conversation, sender, senderName, agent, supportAgent, input, visibility = 'public' }: AppendOptions): Promise<{ message: ParseObject, created: boolean }> {
  const Parse = useParse()

  if (input.clientId) {
    const existing = await new Parse.Query('Message').equalTo('conversation', conversation).equalTo('clientId', input.clientId).first(MASTER)
    if (existing) return { message: existing, created: false }
  }

  let replyToId = ''
  if (input.replyToId) {
    // Only a message in this conversation can be answered; anything else is
    // sent unthreaded rather than refused, so the words still land.
    const original = await new Parse.Query('Message').equalTo('conversation', conversation).equalTo('objectId', input.replyToId).first(MASTER)
    if (original) replyToId = original.id || ''
  }

  const message = new (Parse.Object.extend('Message'))()
  message.set('project', conversation.get('project'))
  message.set('conversation', conversation)
  message.set('sender', sender)
  message.set('senderName', senderName)
  if (agent) message.set('agent', agent)
  if (supportAgent) message.set('supportAgent', supportAgent)
  message.set('body', input.body)
  message.set('attachments', input.attachments)
  message.set('context', input.context)
  message.set('replyToId', replyToId)
  message.set('clientId', input.clientId)
  if (input.emailMessageId) message.set('emailMessageId', input.emailMessageId)
  message.set('visibility', visibility)
  message.set('kind', 'message')
  await message.save(null, MASTER)

  const serialized = serializeMessage(message)
  if (visibility === 'public') {
    const previous = serializeConversation(conversation)
    // A customer writing back resurfaces an archived thread in the queue.
    if (sender === 'user') conversation.unset('archivedAt')
    const type = await getConversationType(conversation.get('project'), previous.type)
    let reopenStatus = previous.status
    const current = statusDefinition(type, previous.status)
    if (sender === 'user' && current.isTerminal && type.userCanReopen) {
      reopenStatus = current.reopenTo || defaultStatus(type).key
      conversation.set('reopenedAt', new Date())
    }
    applyState(conversation, nextStateAfterMessage(previous, serialized, reopenStatus))
    const status = statusDefinition(type, reopenStatus)
    conversation.set('statusCategory', status.category)
    if (sender === 'user' && current.isTerminal && type.userCanReopen) conversation.unset('closedAt')
    await conversation.save(null, MASTER)
    // A customer writing into a closed thread reopens it.
    if (sender === 'user' && reopenStatus !== previous.status) emitStatusChanged(conversation, previous.status, reopenStatus, status.category)
  }

  await publishEvent({
    type: 'message.created',
    projectId: pointerId(conversation.get('project')),
    endUserId: pointerId(conversation.get('endUser')),
    conversationId: conversation.id || '',
    message: serialized,
    conversation: serializeConversationEvent(conversation),
    ...(visibility === 'internal' ? { audience: 'agent' as const } : {})
  })

  void syncConversationForSearch(conversation)
  return { message, created: true }
}

export async function listMessages(conversation: ParseObject, before: string | undefined, limit: unknown = PAGE_SIZE, publicOnly = false): Promise<{ rows: ParseObject[], hasMore: boolean }> {
  const Parse = useParse()
  const size = pageSize(limit)
  const query = new Parse.Query('Message').equalTo('conversation', conversation).descending('createdAt').limit(size)
  // Legacy messages predate `visibility`; Mongo's $ne includes those rows.
  if (publicOnly) query.notEqualTo('visibility', 'internal')
  const beforeDate = before ? new Date(before) : null
  if (beforeDate && !Number.isNaN(beforeDate.getTime())) query.lessThan('createdAt', beforeDate)
  const rows = await query.find(MASTER)
  return { rows: rows.reverse(), hasMore: pageHasMore(rows.length, size) }
}

export async function markRead(conversation: ParseObject, side: 'user' | 'agent', read = true): Promise<void> {
  const unreadField = side === 'user' ? 'unreadByUser' : 'unreadByAgent'
  conversation.set(side === 'user' ? 'userReadAt' : 'agentReadAt', read ? new Date() : null)
  // ponytail: marking unread resets the badge to 1, not the true count of unseen messages — enough to resurface the thread.
  conversation.set(unreadField, read ? 0 : Math.max(1, Number(conversation.get(unreadField) || 0)))
  await conversation.save(null, MASTER)
  await publishEvent({
    type: 'conversation.updated',
    projectId: pointerId(conversation.get('project')),
    endUserId: pointerId(conversation.get('endUser')),
    conversationId: conversation.id || '',
    conversation: serializeConversationEvent(conversation),
    audience: 'agent'
  })
}

/** Archive hides a conversation from the inbox queue without losing it; unarchiving brings it back. */
export async function setArchived(conversation: ParseObject, archived: boolean): Promise<void> {
  if (archived === Boolean(conversation.get('archivedAt'))) return
  if (archived) conversation.set('archivedAt', new Date())
  else conversation.unset('archivedAt')
  await conversation.save(null, MASTER)
  await publishEvent({
    type: 'conversation.updated',
    projectId: pointerId(conversation.get('project')),
    endUserId: pointerId(conversation.get('endUser')),
    conversationId: conversation.id || '',
    conversation: serializeConversationEvent(conversation),
    audience: 'agent'
  })
}

/** Permanently remove a conversation and every message in it. */
export async function deleteConversation(conversation: ParseObject): Promise<void> {
  const snapshot = serializeConversationEvent(conversation)
  const projectId = pointerId(conversation.get('project'))
  const endUserId = pointerId(conversation.get('endUser'))
  const id = conversation.id || ''
  const Parse = useParse()
  // A page at a time: a long thread must not stop at the first 500 messages.
  for (;;) {
    const page = await new Parse.Query('Message').equalTo('conversation', conversation).limit(500).find(MASTER)
    if (page.length) await Parse.Object.destroyAll(page, MASTER)
    if (page.length < 500) break
  }
  await conversation.destroy(MASTER)
  await removeConversationFromSearch(id)
  await publishEvent({ type: 'conversation.deleted', projectId, endUserId, conversationId: id, conversation: snapshot, audience: 'agent' })
}

export async function setStatus(conversation: ParseObject, status: string): Promise<void> {
  const type = await getConversationType(conversation.get('project'), conversation.get('type'))
  const next = statusDefinition(type, status)
  const previous = String(conversation.get('status') || '')
  conversation.set('status', next.key)
  conversation.set('statusCategory', next.category)
  if (next.isTerminal) {
    conversation.set('closedAt', new Date())
    if (next.key === 'done') conversation.set('doneAt', new Date())
  } else {
    conversation.unset('closedAt')
    conversation.unset('doneAt')
  }
  await conversation.save(null, MASTER)
  // No audience: a status change is relevant to the end user too (their report
  // moved to reviewing/resolved), so it reaches their stream, not just agents'.
  await publishEvent({
    type: 'conversation.updated',
    projectId: pointerId(conversation.get('project')),
    endUserId: pointerId(conversation.get('endUser')),
    conversationId: conversation.id || '',
    conversation: serializeConversationEvent(conversation)
  })
  if (previous !== next.key) {
    emitStatusChanged(conversation, previous, next.key, next.category)
    await appendEvent(conversation, { type: 'status.changed', from: previous, to: next.key })
  }
}

/** Agent-only ticket metadata. One save and one internal timeline event keep
 * status, triage fields and audit history together. */
export async function updateConversation(conversation: ParseObject, input: Record<string, unknown>, agent: ParseObject): Promise<void> {
  const type = await getConversationType(conversation.get('project'), conversation.get('type'))
  const changed: Record<string, unknown> = {}
  if (typeof input.status === 'string' && input.status !== conversation.get('status')) {
    const next = statusDefinition(type, input.status)
    changed.status = { from: String(conversation.get('status') || ''), to: next.key }
    conversation.set('status', next.key)
    conversation.set('statusCategory', next.category)
    if (next.isTerminal) { conversation.set('closedAt', new Date()); if (next.key === 'done') conversation.set('doneAt', new Date()) }
    else { conversation.unset('closedAt'); conversation.unset('doneAt') }
  }
  if (typeof input.priority === 'string' && ['low', 'normal', 'high', 'urgent'].includes(input.priority) && input.priority !== conversation.get('priority')) {
    conversation.set('priority', input.priority); changed.priority = input.priority
  }
  if ('tags' in input) {
    const tags = Array.isArray(input.tags) ? input.tags.map(tag => clampText(tag, 40).toLowerCase()).filter(Boolean).filter((tag, i, all) => all.indexOf(tag) === i).slice(0, 20) : []
    conversation.set('tags', tags); changed.tags = tags
  }
  if ('assigneeId' in input) {
    const assigneeId = clampText(input.assigneeId, 40)
    if (assigneeId) {
      const assignee = await new (useParse()).Query('_User').get(assigneeId, MASTER).catch(() => null)
      if (!assignee) throw createError({ statusCode: 400, statusMessage: 'Assignee not found' })
      await assertAssignable(await workspaceIdOfProject(pointerId(conversation.get('project'))), assigneeId)
      conversation.set('assignee', assignee); conversation.set('assignedAt', new Date()); changed.assignee = assigneeId
    } else { conversation.unset('assignee'); conversation.unset('assignedAt'); changed.assignee = '' }
  }
  if ('fields' in input) {
    const merged = { ...(conversation.get('fields') || {}), ...(input.fields && typeof input.fields === 'object' ? input.fields as Record<string, unknown> : {}) }
    const fields = validateConversationFields(merged, type.fields, 'agent')
    conversation.set('fields', fields); changed.fields = Object.keys(fields)
  }
  if (!Object.keys(changed).length) return
  await conversation.save(null, MASTER)
  // A status change reaches the end user's stream; triage-only changes
  // (priority/tags/assignee) stay on the agent timeline via appendEvent below.
  if (changed.status) {
    await publishEvent({
      type: 'conversation.updated',
      projectId: pointerId(conversation.get('project')),
      endUserId: pointerId(conversation.get('endUser')),
      conversationId: conversation.id || '',
      conversation: serializeConversationEvent(conversation)
    })
    const { from, to } = changed.status as { from: string, to: string }
    emitStatusChanged(conversation, from, to, String(conversation.get('statusCategory') || ''))
  }
  await appendEvent(conversation, { type: changed.status ? 'status.changed' : changed.assignee !== undefined ? 'assigned' : 'field.changed', ...changed, byName: agent.get('name') || agent.get('username') || 'Agent' }, agent)
}

/** The `conversation.status_changed` domain event. Fire and forget: the status is already saved. */
function emitStatusChanged(conversation: ParseObject, from: string, to: string, statusCategory: string): void {
  emitDomainEventLater(conversation.get('project'), 'conversation.status_changed', { conversationId: conversation.id, from, to, statusCategory, ...(pointerId(conversation.get('endUser')) ? { contact: { id: pointerId(conversation.get('endUser')) } } : {}) })
}

export async function appendInternalNote(conversation: ParseObject, senderName: string, agent: ParseObject, body: string): Promise<ParseObject> {
  const input = readMessageInput({ body, clientId: `note-${Date.now()}` }, pointerId(conversation.get('project')))
  return (await appendMessage({ conversation, sender: 'agent', senderName, agent, input, visibility: 'internal' })).message
}

export async function appendEvent(conversation: ParseObject, event: Record<string, unknown>, agent?: ParseObject): Promise<ParseObject> {
  const Parse = useParse()
  const row = new (Parse.Object.extend('Message'))()
  row.set('project', conversation.get('project'))
  row.set('conversation', conversation)
  row.set('sender', 'agent')
  row.set('senderName', 'System')
  // An automated actor (a webhook's stand-in, see githubRefs.ts) is not a saved operator: nothing to point at.
  if (agent?.id) row.set('agent', agent)
  row.set('body', '')
  row.set('attachments', [])
  row.set('context', null)
  row.set('replyToId', '')
  row.set('clientId', '')
  row.set('visibility', 'internal')
  row.set('kind', 'event')
  row.set('event', event)
  await row.save(null, MASTER)
  await publishEvent({ type: 'message.created', projectId: pointerId(conversation.get('project')), endUserId: pointerId(conversation.get('endUser')), conversationId: conversation.id || '', message: serializeMessage(row), conversation: serializeConversationEvent(conversation), audience: 'agent' })
  return row
}

function validateConversationFields(value: unknown, definitions: ConversationField[], actor: 'user' | 'agent'): Record<string, unknown> {
  const result = validateFields(value, definitions, actor)
  if (result.errors.length) throw createError({ statusCode: 400, statusMessage: result.errors.join('; ') })
  return result.values
}

/** Delete one message and rebuild the conversation summary from what remains. */
export async function deleteMessage(message: ParseObject): Promise<void> {
  const Parse = useParse()
  const conversation = await getConversation(pointerId(message.get('conversation')))
  await message.destroy(MASTER)

  const last = await new Parse.Query('Message').equalTo('conversation', conversation).notEqualTo('visibility', 'internal').descending('createdAt').first(MASTER)
  const prev = serializeConversation(conversation)

  const unreadAfter = async (side: 'user' | 'agent'): Promise<number> => {
    const readAt = side === 'user' ? conversation.get('userReadAt') : conversation.get('agentReadAt')
    const query = new Parse.Query('Message').equalTo('conversation', conversation).notEqualTo('visibility', 'internal').equalTo('sender', side === 'user' ? 'agent' : 'user')
    if (readAt instanceof Date) query.greaterThan('createdAt', readAt)
    return query.count(MASTER)
  }
  const [unreadUser, unreadAgent] = await Promise.all([unreadAfter('user'), unreadAfter('agent')])

  applyState(conversation, stateAfterDelete(prev, last ? serializeMessage(last) : null, { userReadAt: prev.userReadAt, agentReadAt: prev.agentReadAt }, side => side === 'user' ? unreadUser : unreadAgent))
  await conversation.save(null, MASTER)

  await publishEvent({
    type: 'message.deleted',
    projectId: pointerId(conversation.get('project')),
    endUserId: pointerId(conversation.get('endUser')),
    conversationId: conversation.id || '',
    messageId: message.id || '',
    conversation: serializeConversationEvent(conversation)
  })
}

export async function getMessage(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('Message').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }
}

// ---- reactions ------------------------------------------------------------

export type ReactionActor = { actor: string, side: MessageSender, actorName: string }

/** Pick the same emoji again to take it back; one tapback per emoji per reactor. */
export function toggleReactionList(reactions: MessageReaction[], emoji: MessageReactionEmoji, actor: ReactionActor, at: string): MessageReaction[] {
  return toggleReactions(reactions, emoji, actor, at)
}

/** Toggle one emoji for one reactor and broadcast the new message state. */
export async function toggleMessageReaction(message: ParseObject, emoji: MessageReactionEmoji, actor: ReactionActor): Promise<ParseObject> {
  message.set('reactions', toggleReactionList(normalizeReactions(message.get('reactions')), emoji, actor, new Date().toISOString()))
  await message.save(null, MASTER)
  const conversation = await getConversation(pointerId(message.get('conversation')))
  const serialized = serializeMessage(message)
  await publishEvent({
    type: 'message.updated',
    projectId: pointerId(conversation.get('project')),
    endUserId: pointerId(conversation.get('endUser')),
    conversationId: conversation.id || '',
    message: serialized,
    conversation: serializeConversationEvent(conversation),
    // An internal note must never reach the end user's stream, even as an update.
    ...(serialized.visibility === 'internal' ? { audience: 'agent' as const } : {})
  })
  return message
}
