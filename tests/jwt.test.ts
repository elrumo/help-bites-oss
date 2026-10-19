import { describe, expect, test } from 'bun:test'
import { decodeUnverified, mintIdentityToken, verifyIdentityToken } from '../server/utils/jwt'

const SECRET = 'sk_test_secret'
const PK = 'pk_test'

describe('identity tokens', () => {
  test('round-trips valid claims', () => {
    const token = mintIdentityToken(SECRET, { iss: PK, sub: 'u1', name: 'Ada', email: 'ada@example.com' })
    const result = verifyIdentityToken(token, SECRET, PK)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.claims.sub).toBe('u1')
      expect(result.claims.name).toBe('Ada')
    }
  })

  test('rejects a wrong secret', () => {
    const token = mintIdentityToken(SECRET, { iss: PK, sub: 'u1' })
    expect(verifyIdentityToken(token, 'sk_other', PK)).toEqual({ ok: false, reason: 'bad signature' })
  })

  test('rejects a wrong issuer', () => {
    const token = mintIdentityToken(SECRET, { iss: 'pk_other', sub: 'u1' })
    expect(verifyIdentityToken(token, SECRET, PK)).toEqual({ ok: false, reason: 'wrong issuer' })
  })

  test('rejects an expired token beyond leeway', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = mintIdentityToken(SECRET, { iss: PK, sub: 'u1', exp: now - 120 })
    expect(verifyIdentityToken(token, SECRET, PK, now)).toEqual({ ok: false, reason: 'expired' })
    const fresh = mintIdentityToken(SECRET, { iss: PK, sub: 'u1', exp: now - 30 })
    expect(verifyIdentityToken(fresh, SECRET, PK, now).ok).toBe(true)
  })

  test('rejects tampering and garbage', () => {
    const token = mintIdentityToken(SECRET, { iss: PK, sub: 'u1' })
    const [h, , s] = token.split('.')
    const forged = `${h}.${Buffer.from(JSON.stringify({ iss: PK, sub: 'admin', exp: 9e9 })).toString('base64url')}.${s}`
    expect(verifyIdentityToken(forged, SECRET, PK).ok).toBe(false)
    expect(verifyIdentityToken('nope', SECRET, PK)).toEqual({ ok: false, reason: 'malformed' })
    expect(decodeUnverified('a.b')).toBeNull()
    expect(decodeUnverified(token)?.iss).toBe(PK)
  })

  test('rejects alg=none', () => {
    const head = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ iss: PK, sub: 'u1', exp: 9e9 })).toString('base64url')
    expect(verifyIdentityToken(`${head}.${body}.`, SECRET, PK)).toEqual({ ok: false, reason: 'unsupported alg' })
  })
})
