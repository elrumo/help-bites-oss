import { expect, test } from 'bun:test'
import {
  ANON_FREE_WRITES, CODE_MAX_ATTEMPTS, CODE_TTL_MS, checkVerifyCode, hashEndUserToken, hashVerifyCode,
  isEndUserToken, needsVerification, newAnonExternalId, newEndUserToken, newVerifyCode
} from '../server/utils/endUserTokens'

test('email-only tokens are random, opaque, and stored only as a hash', () => {
  const first = newEndUserToken()
  const second = newEndUserToken()
  expect(first.token).toMatch(/^eu_[0-9a-f]{64}$/)
  expect(isEndUserToken(first.token)).toBe(true)
  expect(first.hash).toBe(hashEndUserToken(first.token))
  expect(first.hash).not.toContain(first.token)
  expect(first.token).not.toBe(second.token)
})

test('a host-signed JWT or an admin key is not an email-only token', () => {
  expect(isEndUserToken('eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe(false)
  expect(isEndUserToken('ak_' + 'a'.repeat(64))).toBe(false)
  expect(isEndUserToken('eu_short')).toBe(false)
})

test('anonymous ids carry a prefix a host id would not collide with by accident', () => {
  expect(newAnonExternalId()).toMatch(/^anon_[0-9a-f]{24}$/)
  expect(newAnonExternalId()).not.toBe(newAnonExternalId())
})

test('codes are six digits', () => {
  for (let i = 0; i < 200; i++) expect(newVerifyCode()).toMatch(/^\d{6}$/)
})

test('the right code opens, a wrong one does not, and a code is bound to its user', () => {
  const now = 1_000_000
  const state = { hash: hashVerifyCode('user1', '123456'), expiresAt: now + CODE_TTL_MS, attempts: 0 }
  expect(checkVerifyCode(state, 'user1', '123456', now)).toBe('ok')
  expect(checkVerifyCode(state, 'user1', ' 123456 ', now)).toBe('ok')
  expect(checkVerifyCode(state, 'user1', '654321', now)).toBe('wrong')
  expect(checkVerifyCode(state, 'user1', 'abcdef', now)).toBe('wrong')
  expect(checkVerifyCode(state, 'user2', '123456', now)).toBe('wrong')
})

test('an expired code, no code, and a locked code all refuse', () => {
  const now = 1_000_000
  const hash = hashVerifyCode('user1', '123456')
  expect(checkVerifyCode({ hash, expiresAt: now - 1, attempts: 0 }, 'user1', '123456', now)).toBe('expired')
  expect(checkVerifyCode(null, 'user1', '123456', now)).toBe('none')
  expect(checkVerifyCode({ hash: '', expiresAt: now + 1000, attempts: 0 }, 'user1', '123456', now)).toBe('none')
  // Once five guesses are spent, even the right code is refused: the person asks for a new one.
  expect(checkVerifyCode({ hash, expiresAt: now + 1000, attempts: CODE_MAX_ATTEMPTS }, 'user1', '123456', now)).toBe('locked')
  expect(checkVerifyCode({ hash, expiresAt: now + 1000, attempts: CODE_MAX_ATTEMPTS - 1 }, 'user1', '123456', now)).toBe('ok')
})

test('only an unverified person past their free writes must verify', () => {
  expect(needsVerification(ANON_FREE_WRITES, false)).toBe(false)
  expect(needsVerification(ANON_FREE_WRITES + 1, false)).toBe(true)
  expect(needsVerification(ANON_FREE_WRITES + 100, true)).toBe(false)
  expect(needsVerification(0, false)).toBe(false)
})
