import { randomBytes } from 'node:crypto'

// Each process caches sessions, memberships, workspaces and projects for a
// short while. When one changes, every process must drop its copy at once,
// or a removed teammate keeps working on another replica until the cache
// runs out. invalidate() clears the local copy and publishes on `sb:inv`;
// every process (plugins/cacheBus.ts) applies what the others publish.

export type CacheKind = 'session' | 'agent' | 'members' | 'workspace' | 'workspaceProjects' | 'projectKey'
export const INVALIDATE_CHANNEL = 'sb:inv'

const ORIGIN = randomBytes(6).toString('hex')
const g = globalThis as unknown as { __sbCacheHandlers?: Map<CacheKind, Set<(key: string) => void>> }

/** Register how this process drops one entry of a cache. */
export function onInvalidate(kind: CacheKind, drop: (key: string) => void): void {
  g.__sbCacheHandlers ||= new Map()
  let set = g.__sbCacheHandlers.get(kind)
  if (!set) g.__sbCacheHandlers.set(kind, set = new Set())
  set.add(drop)
}

export function applyInvalidation(kind: CacheKind, key: string): void {
  for (const drop of g.__sbCacheHandlers?.get(kind) || []) {
    try { drop(key) } catch {}
  }
}

/** Drop an entry here and in every other process. */
export async function invalidate(kind: CacheKind, key: string): Promise<void> {
  applyInvalidation(kind, key)
  try {
    await useRedis().publish(INVALIDATE_CHANNEL, JSON.stringify({ kind, key, origin: ORIGIN }))
  } catch (error) {
    // Other processes fall back to their cache TTL (a minute or so).
    console.warn('[cache] invalidation not broadcast:', (error as Error).message)
  }
}

export function receiveInvalidation(message: { kind?: CacheKind, key?: string, origin?: string }): void {
  if (!message?.kind || typeof message.key !== 'string' || message.origin === ORIGIN) return
  applyInvalidation(message.kind, message.key)
}
