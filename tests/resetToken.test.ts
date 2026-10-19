import { describe, expect, test } from 'bun:test'
import { mintResetToken, readResetToken } from '../server/utils/jwt'

const SECRET = 'master-key-test'

describe('agent password-reset tokens', () => {
  test('round-trips the agent id', () => {
    const token = mintResetToken(SECRET, 'agent123')
    expect(readResetToken(SECRET, token)).toBe('agent123')
  })

  test('rejects a token signed with a different secret', () => {
    const token = mintResetToken(SECRET, 'agent123')
    expect(readResetToken('other-key', token)).toBeNull()
  })

  test('rejects an expired token', () => {
    // -120s clears the verifier's 60s clock-skew leeway.
    const token = mintResetToken(SECRET, 'agent123', -120)
    expect(readResetToken(SECRET, token)).toBeNull()
  })

  test('rejects an identity token from another issuer', () => {
    // A project identity token must not double as a reset token.
    const { mintIdentityToken } = require('../server/utils/jwt')
    const foreign = mintIdentityToken(SECRET, { iss: 'pk_project', sub: 'agent123' })
    expect(readResetToken(SECRET, foreign)).toBeNull()
  })
})
