// The reputation guard's hourly round (server/utils/emailReputation.ts), on
// workers, where the edition turns the guard on: every workspace that sent
// mail in the last 7 days is counted, and one whose bounces or complaints run
// high stops sending bulk mail until staff resume it.

const EVERY_MS = 60 * 60 * 1000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !process.env.REDIS_URL) return
  if (!runsWorkers()) return

  async function round() {
    // Asked on every round: the edition registers from its own plugin, which may load after this one.
    if (!edition().policy.reputationGuard) return
    // One round an hour across every worker; the lock keeps a slow round from overlapping the next one.
    const claimed = await useRedis().set('sb:email:reputation:round', '1', 'EX', 55 * 60, 'NX').catch(() => null)
    if (!claimed) return
    try {
      const result = await runExclusive('sb:email:reputation', 50 * 60, () => checkEmailReputation())
      if (result.ran && result.value.paused.length) console.warn(`[email] bulk sending paused for ${result.value.paused.join(', ')}`)
    } catch (error) {
      console.error('[email] reputation round failed:', (error as Error).message)
    }
  }

  setTimeout(round, 5 * 60_000).unref?.()
  setInterval(round, EVERY_MS).unref?.()
})
