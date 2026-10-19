import { describe, expect, test } from 'bun:test'
import { adminApiKeyExpired, DEFAULT_KEY_DAYS, readKeyExpiry } from '../server/utils/adminApiKeys'
import { setupTokenMatches } from '../server/utils/agents'

const NOW = new Date('2026-10-19T12:00:00Z')
const row = (expiresAt?: Date) => ({ get: (key: string) => (key === 'expiresAt' ? expiresAt : undefined) }) as never

describe('api key expiry', () => {
  test('a key expires after the default days, the days asked for, or never when null', () => {
    expect(readKeyExpiry(undefined, NOW)!.getTime()).toBe(NOW.getTime() + DEFAULT_KEY_DAYS * 86_400_000)
    expect(readKeyExpiry(7, NOW)!.getTime()).toBe(NOW.getTime() + 7 * 86_400_000)
    expect(readKeyExpiry(null, NOW)).toBeNull()
  })

  test('anything else is refused', () => {
    for (const bad of [0, 366, 1.5, 'soon', -1]) expect(() => readKeyExpiry(bad, NOW)).toThrow('expiresInDays')
  })

  test('a key is expired from its date on; one without a date never is', () => {
    expect(adminApiKeyExpired(row(new Date(NOW.getTime() - 1)), NOW.getTime())).toBe(true)
    expect(adminApiKeyExpired(row(new Date(NOW.getTime())), NOW.getTime())).toBe(true)
    expect(adminApiKeyExpired(row(new Date(NOW.getTime() + 1)), NOW.getTime())).toBe(false)
    expect(adminApiKeyExpired(row(undefined), NOW.getTime())).toBe(false)
  })
})

describe('setup token', () => {
  test('an unset token leaves first run open; a set one must match exactly', () => {
    expect(setupTokenMatches('anything', '')).toBe(true)
    expect(setupTokenMatches('s3cret', 's3cret')).toBe(true)
    expect(setupTokenMatches('s3cre', 's3cret')).toBe(false)
    expect(setupTokenMatches(undefined, 's3cret')).toBe(false)
  })
})
