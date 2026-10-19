import Redis from 'ioredis'

// One command client and one subscriber per process. ioredis puts a
// connection into subscriber mode once `subscribe` is called, so the two
// cannot be shared.

const g = globalThis as unknown as { __sbRedis?: Redis, __sbRedisSub?: Redis }

function make(): Redis {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL must be set')
  const client = new Redis(url, { maxRetriesPerRequest: 2 })
  client.on('error', err => console.error('[redis]', err.message))
  return client
}

export function useRedis(): Redis {
  g.__sbRedis ||= make()
  return g.__sbRedis
}

export function useRedisSubscriber(): Redis {
  g.__sbRedisSub ||= make()
  return g.__sbRedisSub
}

// Deletes the lock only if it is still ours: an expired lock another process
// took over must survive our late release.
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

/**
 * Run `fn` while holding a Redis lock, so one process does it even when Nitro
 * runs several. `ran: false` when someone else holds it (after waiting up to
 * `waitMs`). Keep `fn` well under `ttlSeconds`: the lock is not renewed.
 * Without Redis it is skipped, unless `failOpen` says running twice is fine.
 */
export async function runExclusive<T>(key: string, ttlSeconds: number, fn: () => Promise<T>, options: { waitMs?: number, failOpen?: boolean } = {}): Promise<{ ran: true, value: T } | { ran: false }> {
  const token = Math.random().toString(36).slice(2)
  const deadline = Date.now() + (options.waitMs || 0)
  let held = false
  for (;;) {
    try {
      held = (await useRedis().set(key, token, 'EX', ttlSeconds, 'NX')) === 'OK'
    } catch {
      if (!options.failOpen) return { ran: false }
      return { ran: true, value: await fn() }
    }
    if (held || Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!held) return { ran: false }
  try {
    return { ran: true, value: await fn() }
  } finally {
    await useRedis().eval(RELEASE, 1, key, token).catch(() => {})
  }
}
