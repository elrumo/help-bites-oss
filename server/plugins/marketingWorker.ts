// The CRM's background work, one tick every 15 seconds: database syncs and
// Stripe syncs that are due, pricing table numbers and conversions, campaigns that
// are sending, sequence steps, blog posts whose scheduled moment came (their
// webhook) and webhook deliveries.
// No queue: each job's state and cursor live on its own Parse row, and a
// Redis lock per row keeps two processes off the same one, so a crash or a
// deploy just resumes on the next tick.

const TICK_MS = 15_000

const JOBS: [string, () => Promise<void>][] = [
  ['sources', async () => { for (const id of await dueSources(5)) await runSourceSync(id) }],
  ['stripe', async () => { for (const id of await dueStripeAccounts(3)) await runStripeSync(id) }],
  ['pricing', () => runPricingWork()],
  ['campaigns', async () => { if (hasRootSecret()) for (const id of await dueCampaigns(5)) await runCampaign(id) }],
  ['sequences', async () => { if (hasRootSecret()) await runDueSequenceSteps() }],
  ['blog', () => announceDueBlogPosts()],
  ['webhooks', () => deliverDueWebhooks()]
]

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !process.env.REDIS_URL) return
  if (!runsWorkers()) return
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
