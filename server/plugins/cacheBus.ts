// Every process listens for cache invalidations from the others (utils/cacheBus.ts).
export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.REDIS_URL) return
  subscribeChannel(INVALIDATE_CHANNEL, receiveInvalidation)
})
