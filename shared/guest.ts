// Guest access: a visitor with no account and no email address. An admin opens
// it per surface (Project → Settings); the server (server/utils/endUserSessions.ts)
// and the native settings screen (ProjectSettingsScreen.swift) read this list.

/** What a guest may be let into. Lead forms and sign-up forms are public already and need no guest. */
export const GUEST_SURFACES = ['chat', 'feedback', 'comments'] as const
export type GuestSurface = typeof GUEST_SURFACES[number]

/** The surfaces in `value` that exist, once each, in the canonical order. Anything else is dropped. */
export function normalizeGuestSurfaces(value: unknown): GuestSurface[] {
  const given = new Set(Array.isArray(value) ? value.map(String) : [])
  return GUEST_SURFACES.filter(surface => given.has(surface))
}

/** Writes a guest may make in ten minutes, a day, and (across the whole project) an hour. */
export const GUEST_WRITES_PER_10_MIN = 20
export const GUEST_WRITES_PER_DAY = 100
export const GUEST_WRITES_PER_PROJECT_HOUR = 600
/** A guest session is dropped after this long without use. */
export const GUEST_SESSION_IDLE_DAYS = 30
