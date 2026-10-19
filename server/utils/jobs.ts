// Background work that has to happen even if the process that asked for it
// goes away: an AI auto-reply, indexing a knowledge model. Enqueuing writes a
// Job row and pokes the runners over Redis; jobRunner.ts claims due rows with
// a Redis lease, runs them, and retries failures with backoff before giving
// up ("dead"). A crash mid-job leaves a `running` row whose lease runs out,
// and the next runner picks it up again, so handlers must be safe to repeat.
//
// Runners share out the work by workspace: each process runs at most
// JOB_LIMITS.perWorkspace jobs for one workspace at a time and
// JOB_LIMITS.global in all, taking due jobs round-robin across workspaces,
// so one workspace importing ten thousand FAQs can't starve everyone's
// auto-replies.

export type JobHandler = (payload: Record<string, any>) => Promise<void>
type Registered = { run: JobHandler, maxAttempts: number, leaseSeconds: number }

export const JOB_WAKE_CHANNEL = 'sb:jobs:wake'
export const JOB_LIMITS = { perWorkspace: 2, global: 8 }
// The auto-import scanner skips the export right after an array literal, so this one stays last.
export const JOB_BACKOFF_SECONDS = [10, 60, 300, 1800, 7200]

const handlers = new Map<string, Registered>()

export function registerJobHandler(kind: string, run: JobHandler, options: { maxAttempts?: number, leaseSeconds?: number } = {}): void {
  handlers.set(kind, { run, maxAttempts: options.maxAttempts ?? JOB_BACKOFF_SECONDS.length + 1, leaseSeconds: options.leaseSeconds ?? 15 * 60 })
}

export function jobHandler(kind: string): Registered | undefined {
  return handlers.get(kind)
}

/** When to try again after `attempts` failures; null to give up. */
export function nextJobAttempt(attempts: number, maxAttempts: number, now = new Date()): Date | null {
  if (attempts >= maxAttempts) return null
  const wait = JOB_BACKOFF_SECONDS[Math.min(attempts, JOB_BACKOFF_SECONDS.length) - 1] ?? JOB_BACKOFF_SECONDS.at(-1)!
  return new Date(now.getTime() + wait * 1000)
}

/**
 * Which due jobs to start: oldest first, but taking turns across workspaces,
 * never more than `perWorkspace` running for one of them nor `free` in all.
 */
export function pickJobs<T extends { id: string, workspaceId: string }>(due: T[], running: Map<string, number>, free: number, perWorkspace = JOB_LIMITS.perWorkspace): T[] {
  const queues = new Map<string, T[]>()
  for (const job of due) queues.set(job.workspaceId, [...(queues.get(job.workspaceId) || []), job])
  const taken = new Map(running)
  const picked: T[] = []
  while (picked.length < free) {
    let progressed = false
    for (const [workspaceId, queue] of queues) {
      if (picked.length >= free) break
      if (!queue.length || (taken.get(workspaceId) || 0) >= perWorkspace) continue
      picked.push(queue.shift()!)
      taken.set(workspaceId, (taken.get(workspaceId) || 0) + 1)
      progressed = true
    }
    if (!progressed) break
  }
  return picked
}

/**
 * Queue a job. `dedupeKey` skips it when the same work is already waiting
 * (reindexing a model twice in a row is one reindex). When the queue itself
 * is unreachable the job runs right here instead, as it did before there was
 * a queue: late is better than lost.
 */
export async function enqueueJob(kind: string, payload: Record<string, unknown>, options: { workspaceId: string, runAt?: Date, dedupeKey?: string }): Promise<void> {
  const Parse = useParse()
  try {
    if (options.dedupeKey) {
      const waiting = await new Parse.Query('Job').equalTo('dedupeKey', options.dedupeKey).equalTo('status', 'pending').first(MASTER)
      if (waiting) return
    }
    const row = new (Parse.Object.extend('Job'))() as ParseObject
    row.set('kind', kind)
    if (options.workspaceId) row.set('workspace', Parse.Object.extend('Workspace').createWithoutData(options.workspaceId))
    row.set('payload', payload)
    row.set('status', 'pending')
    row.set('attempts', 0)
    row.set('runAt', options.runAt || new Date())
    if (options.dedupeKey) row.set('dedupeKey', options.dedupeKey)
    await row.save(null, MASTER)
    await useRedis().publish(JOB_WAKE_CHANNEL, JSON.stringify({ kind })).catch(() => {})
  } catch (error) {
    console.error(`[jobs] could not queue ${kind}, running it now:`, (error as Error).message)
    const handler = handlers.get(kind)
    if (handler) void handler.run(payload).catch(e => console.error(`[jobs] ${kind} failed:`, (e as Error).message))
  }
}

/** Run one claimed job to its next state: done, retry later, or dead. */
export async function runJob(row: ParseObject): Promise<void> {
  const kind = String(row.get('kind') || '')
  const handler = handlers.get(kind)
  const attempts = Number(row.get('attempts') || 0) + 1
  row.set('status', 'running')
  row.set('attempts', attempts)
  row.set('startedAt', new Date())
  row.set('lockedUntil', new Date(Date.now() + (handler?.leaseSeconds || 900) * 1000))
  await row.save(null, MASTER)
  let error = ''
  try {
    if (!handler) throw new Error(`No handler for ${kind}`)
    await handler.run(row.get('payload') || {})
  } catch (e) {
    error = String((e as { statusMessage?: string }).statusMessage || (e as Error).message || 'Failed').slice(0, 500)
  }
  row.unset('lockedUntil')
  if (!error) {
    row.set('status', 'done')
    row.set('finishedAt', new Date())
    row.unset('lastError')
  } else {
    const next = handler ? nextJobAttempt(attempts, handler.maxAttempts) : null
    row.set('lastError', error)
    if (next) {
      row.set('status', 'pending')
      row.set('runAt', next)
      console.warn(`[jobs] ${kind} ${row.id} failed (attempt ${attempts}), trying again at ${next.toISOString()}: ${error}`)
    } else {
      row.set('status', 'dead')
      row.set('finishedAt', new Date())
      console.error(`[jobs] ${kind} ${row.id} gave up after ${attempts} attempt(s): ${error}`)
    }
  }
  await row.save(null, MASTER)
}

/** Jobs that are due, plus any whose runner died mid-job (lease run out). */
export async function dueJobs(limit = 100): Promise<ParseObject[]> {
  const Parse = useParse()
  const now = new Date()
  const waiting = new Parse.Query('Job').equalTo('status', 'pending').lessThanOrEqualTo('runAt', now)
  const stranded = new Parse.Query('Job').equalTo('status', 'running').lessThanOrEqualTo('lockedUntil', now)
  return await Parse.Query.or(waiting, stranded).ascending('runAt').limit(limit).find(MASTER)
}

/** Finished jobs are kept a week for looking into, then go. */
export async function pruneJobs(max = 1000): Promise<number> {
  const Parse = useParse()
  const old = await new Parse.Query('Job').containedIn('status', ['done', 'dead']).lessThan('finishedAt', new Date(Date.now() - 7 * 24 * 3600 * 1000)).limit(max).find(MASTER)
  if (old.length) await Parse.Object.destroyAll(old, MASTER)
  return old.length
}
