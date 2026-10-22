import { createHmac, timingSafeEqual } from 'node:crypto'

// HS256 identity tokens, minted by a host app with its project secret and
// verified here. Hand-rolled on purpose: it is ~40 lines, and the host-side
// helper in docs/CONNECTING.md is the same code, so integrators can read the
// whole contract in one screen.

export type IdentityClaims = {
  /** Project public key. */
  iss: string
  /** The host app's user id. */
  sub: string
  name?: string
  email?: string
  /** Optional. The handle feedback boards show and `@mention` by (no `@`). */
  username?: string
  /** Optional. An http(s) avatar image URL. */
  avatar?: string
  /** Optional. The person's language, a tag such as `es` or `pt-BR`. It fills the contact's language when that is empty. */
  locale?: string
  /** Optional. `admin` marks one of the host's own staff: they moderate the
   * project's feedback board (statuses, visibility, changelog, any post or
   * comment). The host decides who gets it; the signature makes it unforgeable. */
  role?: string
  /** Set by HelpBites, never read from a token: this person came in with only an email address (an `eu_…` session), so has no host identity. */
  anon?: boolean
  /** Set by HelpBites with `anon`: a guest, who gave no address at all. */
  guest?: boolean
  /** With `anon`: they proved the address with a code. */
  emailVerified?: boolean
  iat: number
  exp: number
}

const LEEWAY_SECONDS = 60

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function mintIdentityToken(secret: string, claims: Omit<IdentityClaims, 'iat' | 'exp'> & { exp?: number, ttlSeconds?: number }): string {
  const now = Math.floor(Date.now() / 1000)
  const { ttlSeconds = 3600, ...rest } = claims
  const payload: IdentityClaims = { ...rest, iat: now, exp: rest.exp ?? now + ttlSeconds }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return `${head}.${body}.${sign(`${head}.${body}`, secret)}`
}

/** Read the payload without checking the signature — only to find which project to verify against. */
export function decodeUnverified(token: string): IdentityClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' ? payload as IdentityClaims : null
  } catch {
    return null
  }
}

export type VerifyResult = { ok: true, claims: IdentityClaims } | { ok: false, reason: string }

// Agent password-reset tokens: an identity token we issue to ourselves,
// signed with the master key. No reset-token table and no new secret — the
// 30-minute TTL is the whole revocation story.
// ponytail: stateless, so a link works until it expires even after use; add a
// Redis jti (we already run Redis) if single-use ever matters.
const RESET_ISS = 'sb:pwreset'

export function mintResetToken(secret: string, agentId: string, ttlSeconds = 1800): string {
  return mintIdentityToken(secret, { iss: RESET_ISS, sub: agentId, ttlSeconds })
}

/** The agent id the token was minted for, or null when it is bad/expired. */
export function readResetToken(secret: string, token: string): string | null {
  const result = verifyIdentityToken(token, secret, RESET_ISS)
  return result.ok ? result.claims.sub : null
}

export function verifyIdentityToken(token: string, secret: string, expectedIss: string, now = Math.floor(Date.now() / 1000)): VerifyResult {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [head, body, signature] = parts as [string, string, string]

  let header: { alg?: string }
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (header?.alg !== 'HS256') return { ok: false, reason: 'unsupported alg' }

  const expected = Buffer.from(sign(`${head}.${body}`, secret))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad signature' }

  const claims = decodeUnverified(token)
  if (!claims) return { ok: false, reason: 'malformed' }
  if (claims.iss !== expectedIss) return { ok: false, reason: 'wrong issuer' }
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) return { ok: false, reason: 'missing sub' }
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_SECONDS < now) return { ok: false, reason: 'expired' }
  if (typeof claims.iat === 'number' && claims.iat - LEEWAY_SECONDS > now) return { ok: false, reason: 'issued in the future' }

  return { ok: true, claims }
}
