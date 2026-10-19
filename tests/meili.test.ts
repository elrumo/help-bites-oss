import { describe, expect, test } from 'bun:test'
import { meiliApiKey } from '../server/utils/meili'

describe('meiliApiKey', () => {
  test('prefers the scoped key, even when the master key is also set', () => {
    expect(meiliApiKey({ MEILI_API_KEY: 'scoped', MEILI_MASTER_KEY: 'master' })).toEqual({ key: 'scoped', master: false })
    expect(meiliApiKey({ MEILI_API_KEY: 'scoped' })).toEqual({ key: 'scoped', master: false })
  })

  test('falls back to the master key and says so', () => {
    expect(meiliApiKey({ MEILI_MASTER_KEY: 'master' })).toEqual({ key: 'master', master: true })
    expect(meiliApiKey({ MEILI_API_KEY: '', MEILI_MASTER_KEY: 'master' })).toEqual({ key: 'master', master: true })
  })

  test('no key at all is a keyless (dev) Meilisearch, not a fallback', () => {
    expect(meiliApiKey({})).toEqual({ key: '', master: false })
  })
})
