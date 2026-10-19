import { randomUUID } from 'node:crypto'
import { useRedis } from './redis'

// A designer turn started from the editor outlives the page: when the browser
// reloads or drops offline, the model keeps going and the turn still lands.
// Its stream is copied into Redis as it is sent, so the chat can re-attach and
// replay it from the start. One turn per template at a time, so two never
// edit the same design at once. Stop may reach another app server than the
// one running the turn: it leaves a flag in Redis, which that server checks
// every second.

export type EmailAiRun = { chatId: string, streamId: string, messageId: string }

const RUN_TTL = 120 // s, refreshed while the turn streams: a crashed server frees the template within two minutes
const REPLAY_TTL = 60 // s a finished turn stays replayable, for a page that asked just as it ended
const ABORT_TTL = 60 // s a Stop waits for the server running the turn to see it
const ABORT_POLL_MS = 1000
const END = '[end]' // SSE chunks all start with "data:", so this can't be one

const runKey = (templateId: string) => `sb:emailai:run:${templateId}`
const streamKey = (templateId: string, streamId: string) => `sb:emailai:stream:${templateId}:${streamId}`
// Stop pressed before the server got as far as starting the turn: by the question it answers.
const stopKey = (templateId: string, askedId: string) => `sb:emailai:stop:${templateId}:${askedId}`
// Stop pressed on another server than the one running the turn.
const abortKey = (streamId: string) => `sb:emailai:abort:${streamId}`

// The turns running in this process, so Stop can abort them.
const controllers = new Map<string, AbortController>()

/** The turn running on a template, if any. */
export async function emailAiRun(templateId: string): Promise<EmailAiRun | null> {
  try {
    const raw = await useRedis().get(runKey(templateId))
    return raw ? JSON.parse(raw) as EmailAiRun : null
  } catch {
    return null
  }
}

/**
 * Claims the template for a turn answering `askedId` with reply `messageId`;
 * null while another turn runs. Without Redis the turn still runs, it just
 * can't be re-attached to (like the rate limiter, this fails open).
 */
export async function startEmailAiRun(templateId: string, chatId: string, askedId: string, messageId: string) {
  const redis = useRedis()
  const run: EmailAiRun = { chatId, streamId: randomUUID(), messageId }
  const controller = new AbortController()
  try {
    if (await redis.set(runKey(templateId), JSON.stringify(run), 'EX', RUN_TTL, 'NX') !== 'OK') return null
    controllers.set(run.streamId, controller)
    watchForStop(templateId, run, controller)
    if (await redis.get(stopKey(templateId, askedId))) {
      await redis.del(stopKey(templateId, askedId))
      controller.abort()
    }
  } catch (error) {
    console.warn('[emails] redis unavailable, this AI turn cannot be re-attached to:', (error as Error).message)
    controllers.set(run.streamId, controller)
  }
  return { ...run, signal: controller.signal, record: (stream: ReadableStream<string>) => record(templateId, run, stream) }
}

/**
 * Aborts the turn when a Stop flag for it turns up, checking about once a
 * second until the turn has ended (its claim on the template is gone or no
 * longer this turn's) or was stopped here.
 */
function watchForStop(templateId: string, run: EmailAiRun, controller: AbortController): void {
  const claim = JSON.stringify(run)
  let checking = false
  const timer = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      const [stop, current] = await useRedis().mget(abortKey(run.streamId), runKey(templateId))
      if (stop) controller.abort()
      if (stop || current !== claim) clearInterval(timer)
    } catch {
      // Redis went away: Stop still works on this server.
    } finally {
      checking = false
    }
  }, ABORT_POLL_MS)
  timer.unref?.()
  controller.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
}

/**
 * Copies the turn's SSE stream into Redis to its very end, then frees the
 * template. Reading it to the end is also what keeps the turn going after the
 * page hangs up. Never rejects: under Bun an unhandled rejection exits the server.
 */
async function record(templateId: string, run: EmailAiRun, stream: ReadableStream<string>): Promise<void> {
  const redis = useRedis()
  const key = streamKey(templateId, run.streamId)
  let saving = true
  let beat = 0
  try {
    const reader = stream.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (!saving) continue
      try {
        await redis.rpush(key, value)
        if (Date.now() - beat > 10_000) {
          beat = Date.now()
          await redis.multi().expire(key, RUN_TTL).expire(runKey(templateId), RUN_TTL).exec()
        }
      } catch {
        saving = false // Redis went away: the turn carries on, it just can't be replayed
      }
    }
  } catch (error) {
    console.error('[emails] the AI turn stream failed:', (error as Error).message)
  } finally {
    controllers.delete(run.streamId)
    try {
      await redis.multi().rpush(key, END).expire(key, REPLAY_TTL).exec()
      // Free the template, unless this claim expired and another turn took it.
      if (await redis.get(runKey(templateId)) === JSON.stringify(run)) await redis.del(runKey(templateId))
    } catch {}
  }
}

/** The turn's stream from its first chunk, following it live to the end; null once it's gone. */
export async function replayEmailAiRun(templateId: string, streamId: string): Promise<ReadableStream<Uint8Array> | null> {
  const redis = useRedis()
  const key = streamKey(templateId, streamId)
  if (!(await redis.exists(key).catch(() => 0))) return null
  const encoder = new TextEncoder()
  let next = 0
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    // ponytail: polls Redis every 150 ms while the turn runs; pub/sub if many pages watch at once.
    async pull(controller) {
      while (!cancelled) {
        const chunks = await redis.lrange(key, next, -1)
        if (cancelled) return
        if (!chunks.length) {
          // Gone mid-turn: the server running it went down.
          if (!(await redis.exists(key))) return controller.close()
          await new Promise(resolve => setTimeout(resolve, 150))
          continue
        }
        next += chunks.length
        for (const chunk of chunks) {
          if (chunk === END) return controller.close()
          controller.enqueue(encoder.encode(chunk))
        }
        return
      }
    },
    cancel() {
      cancelled = true
    }
  })
}

/**
 * Stops the template's turn if it belongs to this chat, wherever it runs, and
 * waits (briefly) until it has wrapped up. With `askedId`, a turn that hasn't
 * started yet stops as soon as it does.
 */
export async function stopEmailAiRun(templateId: string, chatId: string, askedId?: string): Promise<void> {
  const run = await emailAiRun(templateId)
  const controller = run?.chatId === chatId ? controllers.get(run.streamId) : undefined
  if (controller) controller.abort()
  else {
    if (run?.chatId === chatId) await useRedis().set(abortKey(run.streamId), '1', 'EX', ABORT_TTL).catch(() => {})
    if (askedId) await useRedis().set(stopKey(templateId, askedId), '1', 'EX', 60).catch(() => {})
  }
  if (!run || run.chatId !== chatId) return
  for (let i = 0; i < 30 && (await emailAiRun(templateId))?.streamId === run.streamId; i++) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
