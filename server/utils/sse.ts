import type { H3Event } from 'h3'
import type { FeedbackEvent } from '#shared/feedback'
import type { SupportEvent } from './events'

// One SSE stream per client, written straight into the response body. The
// Redis subscription is per process and shared, so a stream only costs a
// listener, and it listens on its own tenant's channel only (events.ts).
//
// Bun.serve closes a connection that has sent nothing for 10 s (its default
// idleTimeout), so the heartbeat has to beat that; it doubles as the keepalive
// that stops a reverse proxy reaping an idle stream.
const HEARTBEAT_MS = 8_000

/** Operators: every project of one workspace, including ones created after the stream opened. */
export function streamWorkspaceEvents(event: H3Event, workspaceId: string, accept: (e: SupportEvent) => boolean = () => true) {
  return openStream(event, push => subscribeWorkspaceEvents(workspaceId, (e) => {
    if (accept(e)) push(e.type, JSON.stringify(e))
  }))
}

/** One project's events (an end user's widget, or an operator watching one project). `map` reshapes what one audience may see; the event itself is shared with every other listener, so never mutate it. */
export function streamProjectEvents(event: H3Event, projectId: string, accept: (e: SupportEvent) => boolean = () => true, map: (e: SupportEvent) => unknown = e => e) {
  return openStream(event, push => subscribeProjectEvents(projectId, (e) => {
    if (accept(e)) push(e.type, JSON.stringify(map(e)))
  }))
}

/** One project's feedback board; `map` may rewrite or drop each event per viewer (hidden posts). */
export function streamFeedbackEvents(event: H3Event, projectId: string, map: (e: FeedbackEvent) => FeedbackEvent | null) {
  return openStream(event, push => subscribeFeedbackEvents(projectId, (e) => {
    const out = map(e)
    if (out) push(out.type, JSON.stringify(out))
  }))
}

/** Saves to one email template, for everyone editing or previewing it. */
export function streamEmailEvents(event: H3Event, templateId: string) {
  return openStream(event, push => subscribeEmailEvents(templateId, (e) => {
    if (e.templateId === templateId) push(e.type, JSON.stringify(e))
  }))
}

function openStream(event: H3Event, subscribe: (push: (type: string, data: string) => void) => () => void) {
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'private, no-cache, no-store, no-transform, must-revalidate, max-age=0',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  // Deliberately not h3's createEventStream: when a client walks away the
  // stream is cancelled, and h3 leaves the writer's `closed` rejection
  // unhandled — under Bun that exits the whole process (nitro only traps
  // unhandled rejections in dev), and the cleanup below never runs either.
  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval>
  let unsubscribe = () => {}

  return new ReadableStream({
    start(controller) {
      const push = (type: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${data}\n\n`))
        } catch {
          // Stream already gone; `cancel` has done the cleanup.
        }
      }
      unsubscribe = subscribe(push)
      heartbeat = setInterval(() => push('ping', '{}'), HEARTBEAT_MS)
      push('ready', '{}')
    },
    cancel() {
      clearInterval(heartbeat)
      unsubscribe()
    }
  })
}
