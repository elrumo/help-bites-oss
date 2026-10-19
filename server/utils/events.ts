import type { Conversation, Message } from '#shared/support'
import type { FeedbackEvent } from '#shared/feedback'
import type { EmailTemplate } from './emails'

// Every write publishes one event on Redis; each process has one subscriber
// connection that fans out to its open SSE streams. The payload is the
// already-serialized object, so clients append without a refetch.
//
// Channels are per tenant, so a stream only ever hears its own workspace's
// events and a process only subscribes to the channels its open streams
// need: a support event goes to its workspace (the operators' inbox) and to
// its project (that project's end users); feedback events to their project's
// board; email saves to the one template being edited. Kinds stay on
// separate channels so a listener never receives a payload shape it was not
// written for.

export const channels = {
  workspace: (workspaceId: string) => `sb:ev:w:${workspaceId}`,
  project: (projectId: string) => `sb:ev:p:${projectId}`,
  feedback: (projectId: string) => `sb:fb:p:${projectId}`,
  email: (templateId: string) => `sb:em:t:${templateId}`
}
/** Workers that act on every workspace's events (push, error sync) listen on this pattern. */
export const ALL_WORKSPACES_PATTERN = 'sb:ev:w:*'

export type EmailEvent = { type: 'email.updated', templateId: string, template: EmailTemplate }

type Audience = 'agent' | 'user'
type SupportEventBase = { projectId: string, endUserId: string, conversationId: string, conversation: Conversation, audience?: Audience, /** Set when published. */ workspaceId?: string }
export type SupportEvent =
  | SupportEventBase & { type: 'message.created', message: Message }
  | SupportEventBase & { type: 'message.updated', message: Message }
  | SupportEventBase & { type: 'message.deleted', messageId: string }
  | SupportEventBase & { type: 'conversation.updated' }
  | SupportEventBase & { type: 'conversation.deleted' }

export async function publishTo(targets: string[], event: unknown): Promise<void> {
  try {
    const payload = JSON.stringify(event)
    const multi = useRedis().multi()
    for (const channel of targets) multi.publish(channel, payload)
    await multi.exec()
  } catch (error) {
    // Live updates are an upgrade, not a requirement; the row is already stored.
    console.warn('[events] publish failed:', (error as Error).message)
  }
}

export async function publishEvent(event: SupportEvent): Promise<void> {
  const workspaceId = await workspaceIdOfProject(event.projectId).catch(() => '')
  const targets = [channels.project(event.projectId), ...(workspaceId ? [channels.workspace(workspaceId)] : [])]
  return publishTo(targets, { ...event, workspaceId })
}

export function publishFeedbackEvent(event: FeedbackEvent): Promise<void> {
  return publishTo([channels.feedback(event.projectId)], event)
}

export function publishEmailEvent(event: EmailEvent): Promise<void> {
  return publishTo([channels.email(event.templateId)], event)
}

type Listener<T> = (event: T) => void
const g = globalThis as unknown as { __sbChannels?: Map<string, Set<Listener<any>>>, __sbPatterns?: Map<string, Set<Listener<any>>>, __sbSubscriberReady?: boolean }

function deliver(listeners: Set<Listener<any>> | undefined, raw: string): void {
  if (!listeners?.size) return
  let event: unknown
  try {
    event = JSON.parse(raw)
  } catch {
    return
  }
  for (const fn of listeners) {
    try {
      fn(event)
    } catch (error) {
      console.error('[events] listener failed:', (error as Error).message)
    }
  }
}

function subscriber() {
  const sub = useRedisSubscriber()
  if (!g.__sbSubscriberReady) {
    g.__sbSubscriberReady = true
    sub.on('message', (from, raw) => deliver(g.__sbChannels?.get(from), raw))
    sub.on('pmessage', (pattern, _from, raw) => deliver(g.__sbPatterns?.get(pattern), raw))
  }
  return sub
}

/**
 * Listen on one Redis channel. The process shares a single subscriber
 * connection: the first listener subscribes the channel, the last one to
 * leave unsubscribes it, so a channel nobody here watches costs nothing.
 */
export function subscribeChannel<T>(channel: string, listener: Listener<T>): () => void {
  g.__sbChannels ||= new Map()
  const sub = subscriber()
  let listeners = g.__sbChannels.get(channel)
  if (!listeners) {
    listeners = new Set()
    g.__sbChannels.set(channel, listeners)
    sub.subscribe(channel).catch(err => console.error('[events] subscribe failed:', err.message))
  }
  listeners.add(listener)
  return () => {
    listeners!.delete(listener)
    if (!listeners!.size && g.__sbChannels?.get(channel) === listeners) {
      g.__sbChannels.delete(channel)
      sub.unsubscribe(channel).catch(() => {})
    }
  }
}

/** Like subscribeChannel, for every channel matching a Redis glob pattern. */
export function subscribePattern<T>(pattern: string, listener: Listener<T>): () => void {
  g.__sbPatterns ||= new Map()
  const sub = subscriber()
  let listeners = g.__sbPatterns.get(pattern)
  if (!listeners) {
    listeners = new Set()
    g.__sbPatterns.set(pattern, listeners)
    sub.psubscribe(pattern).catch(err => console.error('[events] psubscribe failed:', err.message))
  }
  listeners.add(listener)
  return () => {
    listeners!.delete(listener)
    if (!listeners!.size && g.__sbPatterns?.get(pattern) === listeners) {
      g.__sbPatterns.delete(pattern)
      sub.punsubscribe(pattern).catch(() => {})
    }
  }
}

export function subscribeWorkspaceEvents(workspaceId: string, listener: Listener<SupportEvent>): () => void {
  return subscribeChannel(channels.workspace(workspaceId), listener)
}

export function subscribeProjectEvents(projectId: string, listener: Listener<SupportEvent>): () => void {
  return subscribeChannel(channels.project(projectId), listener)
}

export function subscribeFeedbackEvents(projectId: string, listener: Listener<FeedbackEvent>): () => void {
  return subscribeChannel(channels.feedback(projectId), listener)
}

export function subscribeEmailEvents(templateId: string, listener: Listener<EmailEvent>): () => void {
  return subscribeChannel(channels.email(templateId), listener)
}

/** Every workspace's support events: for workers, never for a stream. */
export function subscribeAllWorkspaceEvents(listener: Listener<SupportEvent>): () => void {
  return subscribePattern(ALL_WORKSPACES_PATTERN, listener)
}
