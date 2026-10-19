import { expect, test } from 'bun:test'
import { hashAdminApiKey, newAdminApiKey } from '../server/utils/adminApiKeys'

test('admin API keys are random and only their hash is persisted', () => {
  const first = newAdminApiKey()
  const second = newAdminApiKey()
  expect(first.token).toMatch(/^ak_[0-9a-f]{64}$/)
  expect(first.hash).toBe(hashAdminApiKey(first.token))
  expect(first.hash).not.toContain(first.token)
  expect(first.token).not.toBe(second.token)
})
