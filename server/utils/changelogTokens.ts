import { createHmac, timingSafeEqual } from 'node:crypto'
import { derivedSecret } from './secrets'

// Signed links for the changelog subscription emails: the confirm link of the
// double opt-in mail and the unsubscribe link of every notification.
//
// The payload names a subscription by its id, never by email: an email in a URL
// leaks into logs, browser history and forwarded messages. Confirm tokens
// expire (a stale opt-in request should not be confirmable months later);
// unsubscribe tokens never do, because an unsubscribe link that stops working
// turns into a spam complaint.
//
// The key is its own secret (`CHANGELOG_LINK_SECRET`), not the project's: rotating
// a project secret must not break every unsubscribe link ever sent. The format
// (`purpose:subscriptionId:issuedAt`, base64url, HMAC-SHA256 hex) is the one the
// format other changelog senders commonly use, so links sent before a move still verify with the same secret.
// Every link hands out a payload and its HMAC, so a short secret can be guessed
// offline: under 32 characters it counts as not set. Unset, the key is derived
// from HELPBITES_SECRET; setting CHANGELOG_LINK_SECRET later voids those links.

export type ChangelogTokenPurpose = 'confirm' | 'unsub'

const CONFIRM_EXPIRY_SECONDS = 7 * 24 * 60 * 60
const MIN_SECRET_LENGTH = 32

export const CHANGELOG_LINK_SECRET_REQUIRED = `Changelog links need CHANGELOG_LINK_SECRET or HELPBITES_SECRET (either ${MIN_SECRET_LENGTH}+ characters) on the server`

/** The signing key; '' when links cannot be signed. */
export function changelogLinkSecret(): string {
  const own = process.env.CHANGELOG_LINK_SECRET || ''
  if (own) return own.length >= MIN_SECRET_LENGTH ? own : ''
  return derivedSecret('changelog-link')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function createChangelogToken(purpose: ChangelogTokenPurpose, subscriptionId: string, issuedAt: Date = new Date(), secret: string = changelogLinkSecret()): string {
  if (!secret) throw new Error(CHANGELOG_LINK_SECRET_REQUIRED)
  const payload = `${purpose}:${subscriptionId}:${Math.floor(issuedAt.getTime() / 1000)}`
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, secret)}`
}

export type ChangelogTokenResult =
  | { valid: true, purpose: ChangelogTokenPurpose, subscriptionId: string }
  | { valid: false, error: string }

export function verifyChangelogToken(token: unknown, now: Date = new Date(), secret: string = changelogLinkSecret()): ChangelogTokenResult {
  if (!secret) return { valid: false, error: 'Links are not configured' }
  if (!token || typeof token !== 'string' || token.length > 500) return { valid: false, error: 'Token is required' }
  const parts = token.split('.')
  if (parts.length !== 2) return { valid: false, error: 'Invalid token format' }
  const [encoded, providedHmac] = parts as [string, string]

  const fields = Buffer.from(encoded, 'base64url').toString('utf8').split(':')
  if (fields.length !== 3) return { valid: false, error: 'Invalid token format' }
  const [purpose, subscriptionId, issuedAtRaw] = fields as [string, string, string]
  if (purpose !== 'confirm' && purpose !== 'unsub') return { valid: false, error: 'Invalid token purpose' }
  if (!/^[A-Za-z0-9]{1,60}$/.test(subscriptionId)) return { valid: false, error: 'Invalid token format' }
  const issuedAt = parseInt(issuedAtRaw, 10)
  if (Number.isNaN(issuedAt)) return { valid: false, error: 'Invalid token timestamp' }

  // The signature before the expiry, so a tampered token never learns whether the timestamp it forged would have been in range.
  const provided = Buffer.from(providedHmac, 'hex')
  const expected = Buffer.from(sign(`${purpose}:${subscriptionId}:${issuedAtRaw}`, secret), 'hex')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return { valid: false, error: 'Invalid token signature' }

  if (purpose === 'confirm' && Math.floor(now.getTime() / 1000) - issuedAt > CONFIRM_EXPIRY_SECONDS) return { valid: false, error: 'Token has expired' }
  return { valid: true, purpose, subscriptionId }
}
