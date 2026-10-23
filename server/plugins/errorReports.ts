// Scheduled AI reports on a project's errors (server/utils/errorAi.ts): every
// 15 minutes, the projects whose schedule is due get a new saved report.

const TICK_MS = 15 * 60 * 1000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !process.env.REDIS_URL) return
  if (!runsWorkers()) return

  async function beat() {
    // One instance does the round when Nitro runs more than one.
    const claimed = await useRedis().set('sb:errreports:tick', '1', 'EX', 10 * 60, 'NX').catch(() => null)
    if (claimed) await runErrorReportsTick().catch(error => console.error('[error-reports] tick failed:', (error as Error).message))
  }

  setTimeout(beat, 60_000).unref?.()
  setInterval(beat, TICK_MS).unref?.()
})
