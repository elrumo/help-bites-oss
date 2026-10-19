// The CRM's background work, one tick every 15 seconds: database syncs that
// are due, campaigns that are sending, sequence steps and webhook deliveries.
// No queue: each job's state and cursor live on its own Parse row, and a
// Redis lock per row keeps two processes off the same one, so a crash or a
// deploy just resumes on the next tick.

const TICK_MS = 15_000

const JOBS: [string, () => Promise<void>][] = [
  ['sources', async () => { for (const id of await dueSources(5)) await runSourceSync(id) }],
  ['campaigns', async () => { for (const id of await dueCampaigns(5)) await runCampaign(id) }],
  ['sequences', () => runDueSequenceSteps()],
  ['webhooks', () => deliverDueWebhooks()]
]

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !process.env.REDIS_URL) return
  if (!runsWorkers()) return
  if (!hasRootSecret()) {
    console.warn('[worker] HELPBITES_SECRET is not set: database syncs, campaigns and sequences will not run')
    return
  }
  let busy = false
  async function tick() {
    if (busy) return
    busy = true
    try {
      for (const [name, run] of JOBS) {
        try { await run() } catch (error) { console.error(`[worker] ${name}:`, (error as Error).message) }
      }
    } finally {
      busy = false
    }
  }
  setTimeout(tick, 20_000).unref?.()
  setInterval(tick, TICK_MS).unref?.()
})
