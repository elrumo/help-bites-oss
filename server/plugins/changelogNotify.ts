// The changelog's notification scheduler: every five minutes, for each project
// with `changelog.notify` on, the instant sweep and the weekly digest.
//
// A plain interval in a Nitro plugin, like the email-log pruning: this server is
// one persistent process, so an interval is exactly as reliable as the process.
// It is OFF unless ENABLE_CHANGELOG_NOTIFY=true, so a deploy never starts mailing
// subscribers before the operator turns it on (and a second system that still
// sends the same digests must be switched off first). Redis makes one instance
// do the work when Nitro runs more than one. `POST /v1/admin/changelog/notify/run`
// runs a beat by hand.

const TICK_MS = 5 * 60 * 1000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || process.env.ENABLE_CHANGELOG_NOTIFY !== 'true') return
  if (!runsWorkers()) return

  async function beat() {
    const claimed = await useRedis().set('sb:changelog:tick', '1', 'EX', 240, 'NX').catch(() => null)
    if (claimed) await runChangelogTick()
  }

  setTimeout(beat, 30_000).unref?.()
  setInterval(beat, TICK_MS).unref?.()
})
