import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { iso } from '../server/utils/parse'

// adminApiKeys.ts leans on nitro's auto-imports; supply the one it needs before loading it.
;(globalThis as Record<string, unknown>).iso = iso
const { readOnlyKeyMay, serializeAdminApiKey } = await import('../server/utils/adminApiKeys')

describe('what a read-only key may call', () => {
  test('reads, and the MCP endpoint whose tool calls are checked one by one', () => {
    for (const method of ['GET', 'get', 'HEAD', 'OPTIONS']) expect(readOnlyKeyMay(method, '/v1/admin/conversations')).toBe(true)
    expect(readOnlyKeyMay('POST', '/mcp')).toBe(true)
    expect(readOnlyKeyMay('POST', '/mcp?x=1')).toBe(true)
  })

  test('nothing that changes anything', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(readOnlyKeyMay(method, '/v1/admin/conversations/c1')).toBe(false)
    // A path that merely starts like the MCP endpoint is not it.
    expect(readOnlyKeyMay('POST', '/mcp/../v1/admin/conversations')).toBe(false)
    expect(readOnlyKeyMay('POST', '/mcpx')).toBe(false)
    expect(readOnlyKeyMay('POST', '/v1/admin/mcp')).toBe(false)
  })
})

describe('a key row', () => {
  const row = (fields: Record<string, unknown>) => ({ id: 'K1', createdAt: new Date('2026-01-01'), get: (key: string) => fields[key] }) as never

  test('says whether it only reads', () => {
    expect(serializeAdminApiKey(row({ name: 'n', prefix: 'ak_abc' })).readOnly).toBe(false)
    expect(serializeAdminApiKey(row({ name: 'n', prefix: 'ak_abc', readOnly: true })).readOnly).toBe(true)
    expect(serializeAdminApiKey(row({ name: 'n', prefix: 'ak_abc', readOnly: 'yes' })).readOnly).toBe(false)
  })
})

describe('the one place keys are checked', () => {
  test('refuses a write from a read-only key before any route runs', () => {
    const source = readFileSync(join(import.meta.dir, '../server/utils/auth.ts'), 'utf8')
    expect(source).toMatch(/apiKeyReadOnly && !readOnlyKeyMay\(event\.method, event\.path\)/)
    expect(source).toContain("code: 'key_read_only'")
    // After the key is known to be real and unexpired, and before the identity is handed back.
    expect(source.indexOf('adminApiKeyExpired(')).toBeLessThan(source.indexOf('readOnlyKeyMay('))
    expect(source.indexOf('readOnlyKeyMay(')).toBeLessThan(source.indexOf('return { agent, agentId'))
  })
})
