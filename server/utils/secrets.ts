import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'

// HELPBITES_SECRET is the root of the server's own secrets: it seals stored
// credentials (database URLs, service-account keys) and signs the links it
// mails (unsubscribe, confirm). One key per purpose is derived from it, so a
// signature for one can never pass as the other. Never fall back to another
// key: rotating a project secret must not break old unsubscribe links.

export function hasRootSecret(): boolean {
  return (process.env.HELPBITES_SECRET || '').length >= 32
}

function key(purpose: string): Buffer {
  if (!hasRootSecret()) throw createError({ statusCode: 503, statusMessage: 'Set HELPBITES_SECRET (32+ characters) on the server first' })
  return createHmac('sha256', process.env.HELPBITES_SECRET!).update(`helpbites:${purpose}`).digest()
}

/** A purpose-bound key (hex) for code that signs in its own format; '' without the root secret. */
export function derivedSecret(purpose: string): string {
  return hasRootSecret() ? key(purpose).toString('hex') : ''
}

/** AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key('seal:v1'), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), data].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function openSealedSecret(sealed: string): string {
  const [version, iv, tag, data] = String(sealed || '').split('.')
  if (version !== 'v1' || !iv || !tag || data === undefined) throw createError({ statusCode: 500, statusMessage: 'A stored credential is unreadable; enter it again' })
  try {
    const decipher = createDecipheriv('aes-256-gcm', key('seal:v1'), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'A stored credential does not open with this HELPBITES_SECRET; enter it again' })
  }
}

/** `<payload>.<hmac>` for links; the payload is base64url text, readable but not forgeable. */
export function signLinkToken(purpose: string, payload: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url')
  return `${body}.${createHmac('sha256', key(`link:${purpose}`)).update(body).digest('base64url').slice(0, 32)}`
}

export function readLinkToken(purpose: string, token: string): string | null {
  const [body, mac] = String(token || '').split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', key(`link:${purpose}`)).update(body).digest('base64url').slice(0, 32)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return Buffer.from(body, 'base64url').toString('utf8')
}

/**
 * A credential an operator typed in (an LLM key), as it is stored: sealed when
 * the server has HELPBITES_SECRET, as written when it has not (a community
 * install that never set one keeps working; the cloud edition requires it).
 */
export function storeCredential(plain: string): string {
  return plain && hasRootSecret() ? sealSecret(plain) : plain
}

/** What storeCredential stored, or a credential saved before sealing existed. */
export function readCredential(stored: unknown): string {
  const value = String(stored || '')
  return /^v1\.[\w-]+\.[\w-]+\.[\w-]*$/.test(value) ? openSealedSecret(value) : value
}
