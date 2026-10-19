import { describe, expect, test } from 'bun:test'
import type { SupportEvent } from '../server/utils/events'

// sse.ts leans on nitro's auto-imports; stub them before loading it.
const g = globalThis as Record<string, unknown>
let listener: ((e: SupportEvent) => void) | null = null
let subscribedTo = ''
g.setResponseHeaders = () => {}
g.subscribeWorkspaceEvents = (workspaceId: string, fn: (e: SupportEvent) => void) => {
  subscribedTo = `workspace:${workspaceId}`
  listener = fn
  return () => { listener = null }
}
g.subscribeProjectEvents = (projectId: string, fn: (e: SupportEvent) => void) => {
  subscribedTo = `project:${projectId}`
  listener = fn
  return () => { listener = null }
}
const { streamWorkspaceEvents, streamProjectEvents } = await import('../server/utils/sse')

const event = (projectId: string) => ({ type: 'conversation.updated', projectId, endUserId: 'u', conversationId: 'c', conversation: { id: 'c' } } as unknown as SupportEvent)

async function frames(reader: ReadableStreamDefaultReader<Uint8Array>, n: number) {
  const out: string[] = []
  const decoder = new TextDecoder()
  while (out.length < n) out.push(decoder.decode((await reader.read()).value))
  return out
}

describe('event streams', () => {
  test('an operator stream listens on its own workspace\'s channel only', () => {
    streamWorkspaceEvents({} as never, 'w1').getReader()
    expect(subscribedTo).toBe('workspace:w1')
    streamProjectEvents({} as never, 'p9').getReader()
    expect(subscribedTo).toBe('project:p9')
  })

  test('sends ready, forwards accepted events and drops the rest', async () => {
    const stream = streamWorkspaceEvents({} as never, 'w1', e => e.projectId === 'p1')
    const reader = stream.getReader()
    expect((await frames(reader, 1))[0]).toBe('event: ready\ndata: {}\n\n')

    listener!(event('other'))
    listener!(event('p1'))
    const [frame] = await frames(reader, 1)
    expect(frame).toContain('event: conversation.updated')
    expect(frame).toContain('"projectId":"p1"')
  })

  test('a client that walks away unsubscribes, and a late write is swallowed', async () => {
    const stream = streamProjectEvents({} as never, 'p1', () => true)
    const reader = stream.getReader()
    await frames(reader, 1)
    const push = listener!

    await reader.cancel()
    expect(listener).toBeNull()
    push(event('p1')) // the h3 stream threw here, and the rejection killed the process
  })
})
