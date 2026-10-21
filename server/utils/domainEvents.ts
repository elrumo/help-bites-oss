import { randomBytes } from 'node:crypto'
import type { DomainEvent } from '#shared/domainEvents'
import { matchesEventFilter } from '#shared/domainEvents'
import type { ParseObject } from './parse'
import { queueWebhooks } from './webhooks'

// The domain-event bus. Anything that happens in a project and that another
// feature (or the developer's app) might care about is published here once:
//
//   await emitDomainEvent(project, 'changelog.entry.published', { entryId })
//
// Handlers registered with `onDomainEvent` run first, in this process, each
// isolated: one that throws is logged and never stops the rest, or the write
// that emitted the event. Then the event is queued for every webhook endpoint
// whose filter matches (server/utils/webhooks.ts). Events carry ids, not rows.
// Emitting is best effort by design: the row that changed is already saved.

export type DomainEventHandler = (event: DomainEvent, project: ParseObject) => Promise<void> | void

type Registration = { name: string, pattern: string, handler: DomainEventHandler }
const g = globalThis as unknown as { __sbDomainHandlers?: Registration[] }
const handlers = (): Registration[] => (g.__sbDomainHandlers ||= [])

/** Listen to events matching `pattern` (`*`, `group.*` or a type). A name registered twice replaces the first, so hot reloads do not double up. */
export function onDomainEvent(name: string, pattern: string, handler: DomainEventHandler): void {
  const list = handlers()
  const at = list.findIndex(r => r.name === name)
  if (at >= 0) list.splice(at, 1)
  list.push({ name, pattern, handler })
}

export function newDomainEvent(project: ParseObject, type: string, data: Record<string, unknown>): DomainEvent {
  return { id: `evt_${randomBytes(12).toString('hex')}`, type, createdAt: new Date().toISOString(), projectId: project.id || '', data }
}

/** Publish one event: in-process handlers, then webhook endpoints. Never throws. */
export async function emitDomainEvent(project: ParseObject, type: string, data: Record<string, unknown>): Promise<DomainEvent> {
  const event = newDomainEvent(project, type, data)
  const mine = handlers().filter(r => matchesEventFilter(type, [r.pattern]))
  await Promise.all(mine.map(async (r) => {
    try {
      await r.handler(event, project)
    } catch (error) {
      console.error(`[events] handler "${r.name}" failed on ${type}:`, (error as Error).message)
    }
  }))
  try {
    await queueWebhooks(project, event)
  } catch (error) {
    console.error(`[events] could not queue webhooks for ${type}:`, (error as Error).message)
  }
  return event
}

/** Fire and forget, for places that must not wait on handlers (a request path). */
export function emitDomainEventLater(project: ParseObject, type: string, data: Record<string, unknown>): void {
  void emitDomainEvent(project, type, data)
}
