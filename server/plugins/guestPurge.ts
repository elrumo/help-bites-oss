// Guest access makes a contact per visitor. Every six hours, sessions that ran
// out go, and so do guests who never wrote anything and have been away longer
// than a session lasts, a thousand at a time.

const EVERY_MS = 6 * 60 * 60 * 1000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL) return
  if (!runsWorkers()) return

  async function purge() {
    // Redis makes one process do it even when Nitro runs more than one.
    const claimed = await useRedis().set('sb:guests:purge', '1', 'EX', 60 * 60, 'NX').catch(() => null)
    if (!claimed) return
    try {
      const { sessions, guests } = await purgeIdleGuests()
      if (sessions || guests) console.log(`[guests] removed ${sessions} expired sessions and ${guests} idle guests`)
    } catch (error) {
      console.error('[guests] purge failed:', (error as Error).message)
    }
  }

  setTimeout(purge, 90_000).unref?.()
  setInterval(purge, EVERY_MS).unref?.()
})
