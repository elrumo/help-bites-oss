import type { GuestSurface } from '#shared/guest'

// A guest session for an embed that its host gave no identity token: kept in
// this frame's localStorage so a visitor stays the same guest, and a new one is
// made (POST /v1/anonymous/guest, rate limited) only when there is none or the
// server dropped it. Storage can be blocked in a third-party frame; the guest
// then lasts until the page closes.

export function useGuestSession(pk: string) {
  const key = `helpbites:guest:${pk}`
  let memory: string | null = null

  function stored(): string | null {
    try { return localStorage.getItem(key) || memory } catch { return memory }
  }

  function keep(token: string | null) {
    memory = token
    try {
      if (token) localStorage.setItem(key, token)
      else localStorage.removeItem(key)
    } catch { /* blocked: memory only */ }
  }

  /** The guest this browser already is, or null. */
  function restore(): string | null {
    const token = stored()
    return token && /^eu_[0-9a-f]{64}$/.test(token) ? token : null
  }

  /** The guest this browser already is, else a new one. Null when the project has no guests for `surface`. */
  async function start(surfaces: GuestSurface[] | undefined, surface: GuestSurface): Promise<string | null> {
    const existing = restore()
    if (existing) return existing
    if (!surfaces?.includes(surface)) return null
    try {
      const result = await $fetch<{ token: string }>('/v1/anonymous/guest', { method: 'POST', body: { pk } })
      keep(result.token)
      return result.token
    } catch {
      return null
    }
  }

  return { restore, start, forget: () => keep(null) }
}
