// Runs the Job outbox (server/utils/jobs.ts) in this process: woken over
// Redis when something is queued, and every few seconds regardless, for
// retries and for jobs a dead runner left behind.

const POLL_MS = 5_000
// A suspended or deleting workspace's work waits, out of everyone else's way;
// exporting it and deleting it are all it may still do.
const RUNS_WHILE_INACTIVE = new Set(['workspace.export', 'workspace.purge'])
const INACTIVE_RETRY_MS = 60 * 60_000

async function deferJob(row: ParseObject): Promise<void> {
  row.set('status', 'pending')
  row.set('runAt', new Date(Date.now() + INACTIVE_RETRY_MS))
  row.unset('lockedUntil')
  await row.save(null, MASTER)
}

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !process.env.REDIS_URL) return

  registerJobHandler('ai.autoReply', payload => runAutoReply(String(payload.conversationId || ''), String(payload.messageId || '')), { maxAttempts: 3, leaseSeconds: 300 })
  registerJobHandler('knowledge.index', payload => runKnowledgeIndex({ modelId: String(payload.modelId || ''), documentId: String(payload.documentId || ''), all: payload.all === true }))
  // Both walk all of a workspace's data.
  registerJobHandler('workspace.export', payload => runWorkspaceExport(String(payload.workspaceId || ''), String(payload.requestedBy || '')), { maxAttempts: 3, leaseSeconds: 30 * 60 })
  registerJobHandler('workspace.purge', payload => purgeWorkspace(String(payload.workspaceId || '')), { leaseSeconds: 30 * 60 })
  // Every role knows the handlers, so enqueueJob's run-it-here fallback still works on a web replica; only workers poll.
  if (!runsWorkers()) return

  const running = new Map<string, number>()
  let active = 0
  let polling = false
  let again = false

  async function poll() {
    if (polling) {
      again = true
      return
    }
    polling = true
    try {
      const free = JOB_LIMITS.global - active
      if (free <= 0) return
      const due = await dueJobs(100)
      const candidates = due.map(row => ({ id: row.id || '', workspaceId: pointerId(row.get('workspace')), row }))
      for (const { row, workspaceId } of pickJobs(candidates, running, free)) {
        // The lease keeps other runners off it; the row's lockedUntil brings it back if this one dies.
        const kind = String(row.get('kind'))
        const lease = jobHandler(kind)?.leaseSeconds || 900
        const claimed = await useRedis().set(`sb:job:${row.id}`, '1', 'EX', lease, 'NX').catch(() => null)
        if (claimed !== 'OK') continue
        if (!RUNS_WHILE_INACTIVE.has(kind) && !(await workspaceIsActive(workspaceId).catch(() => true))) {
          await deferJob(row).catch(error => console.error('[jobs] could not defer:', (error as Error).message))
          await useRedis().del(`sb:job:${row.id}`).catch(() => {})
          continue
        }
        active++
        running.set(workspaceId, (running.get(workspaceId) || 0) + 1)
        void runJob(row)
          .catch(error => console.error('[jobs] runner:', (error as Error).message))
          .finally(async () => {
            active--
            running.set(workspaceId, (running.get(workspaceId) || 1) - 1)
            await useRedis().del(`sb:job:${row.id}`).catch(() => {})
            void poll()
          })
      }
    } catch (error) {
      console.error('[jobs] poll failed:', (error as Error).message)
    } finally {
      polling = false
      if (again) {
        again = false
        void poll()
      }
    }
  }

  // GET /v1/health reports `worker: true` while some runner keeps this key alive.
  const heartbeat = () => void useRedis().set('sb:worker:heartbeat', new Date().toISOString(), 'EX', 60).catch(() => {})
  heartbeat()
  setInterval(heartbeat, 20_000).unref?.()

  subscribeChannel(JOB_WAKE_CHANNEL, () => void poll())
  setTimeout(poll, 3_000).unref?.()
  setInterval(poll, POLL_MS).unref?.()
  setInterval(() => void pruneJobs().catch(() => {}), 60 * 60 * 1000).unref?.()
})
