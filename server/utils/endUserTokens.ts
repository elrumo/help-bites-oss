import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

// The pure half of email-only users (server/utils/endUserSessions.ts holds the
// database half): token and code shapes, hashing, and the limits that decide
// when a person has to prove their address. Crypto only, so it is unit-tested
// without Parse or Redis.

/** Writes an unverified email-only user may make before they must enter a code. */
export const ANON_FREE_WRITES = 5
export const CODE_TTL_MS = 10 * 60 * 1000
export const CODE_MAX_ATTEMPTS = 5

/** `eu_` + 32 random bytes: an opaque bearer token for an email-only user. Only its hash is stored. */
export function newEndUserToken(): { token: string, hash: string, prefix: string } {
  const token = `eu_${randomBytes(32).toString('hex')}`
  return { token, hash: hashEndUserToken(token), prefix: token.slice(0, 11) }
}

export function hashEndUserToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const isEndUserToken = (token: string): boolean => /^eu_[0-9a-f]{64}$/.test(token)

/** The id an email-only user is known by. The `anon_` prefix keeps it apart from a host's own ids. */
export function newAnonExternalId(): string {
  return `anon_${randomBytes(12).toString('hex')}`
}

/** The id a guest (no email at all) is known by. */
export function newGuestExternalId(): string {
  return `guest_${randomBytes(12).toString('hex')}`
}

/** "Guest 7f3a": enough for an operator to tell two guests apart in the inbox. */
export function guestDisplayName(externalId: string): string {
  return `Guest ${externalId.slice(-4)}`
}

/** Six digits, zero-padded. */
export function newVerifyCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Bound to the user, so a leaked hash of one person's code says nothing about another's. */
export function hashVerifyCode(endUserId: string, code: string): string {
  return createHash('sha256').update(`${endUserId}:${code.trim()}`).digest('hex')
}

export type CodeState = { hash: string, expiresAt: number, attempts: number }
export type CodeCheck = 'ok' | 'wrong' | 'expired' | 'locked' | 'none'

/** Does `code` open this state? A locked state refuses even the right code. */
export function checkVerifyCode(state: CodeState | null, endUserId: string, code: string, now = Date.now()): CodeCheck {
  if (!state || !state.hash) return 'none'
  if (state.attempts >= CODE_MAX_ATTEMPTS) return 'locked'
  if (state.expiresAt < now) return 'expired'
  if (!/^\d{6}$/.test(code.trim())) return 'wrong'
  const given = Buffer.from(hashVerifyCode(endUserId, code))
  const wanted = Buffer.from(state.hash)
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? 'ok' : 'wrong'
}

/** The write that finds `writes` already made (the one being attempted included) past the free ones. */
export function needsVerification(writes: number, verified: boolean): boolean {
  return !verified && writes > ANON_FREE_WRITES
}
