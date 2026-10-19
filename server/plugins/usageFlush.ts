// Copy plan usage counters from Redis into WorkspaceUsage every five minutes
// (server/utils/usage.ts). SPOP hands each changed key to one process, so
// several replicas can all run this without writing the same row twice.

const EVERY_MS = 5 * 60 * 1000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !process.env.REDIS_URL) return
  if (!runsWorkers()) return
  async function flush() {
    try {
      while (await flushUsage(1000) >= 1000);
    } catch (error) {
      console.error('[usage] flush failed:', (error as Error).message)
    }
  }
  setInterval(flush, EVERY_MS).unref?.()
})
