import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Who can sign in, with what, and where notifications go are changed by a person in the panel, never by an API key: an
// AI assistant steered by text a customer wrote holds one, and a key that could mint another key, add a teammate or reveal a
// project secret would hand over a way back in that outlives the connection you can revoke. See assertSession in
// server/utils/tenancy.ts.

const ROOT = join(import.meta.dir, '..')
const source = (route: string) => readFileSync(join(ROOT, 'server/routes/v1/admin', route), 'utf8')

const SESSION_ONLY = [
  'api-keys/index.post.ts',
  'api-keys/[id].patch.ts',
  'api-keys/[id].delete.ts',
  'agents/index.post.ts',
  'agents/[id].patch.ts',
  'agents/[id].delete.ts',
  'invitations/index.post.ts',
  'invitations/[id].delete.ts',
  'projects/index.post.ts',
  'projects/[id]/secret.get.ts',
  'projects/[id]/rotate-secret.post.ts',
  'workspace/ai.put.ts',
  'workspace/index.delete.ts',
  'telegram/connect.post.ts',
  'devices/index.post.ts',
  'oauth/authorize.post.ts'
]

describe('credential and access routes need a signed-in person', () => {
  test('every one refuses an API key', () => {
    expect(SESSION_ONLY.filter(route => !/\bassertSession\(/.test(source(route)))).toEqual([])
  })

  test('the guard runs before the route reads anything', () => {
    // After authenticating and before the body is read or a row loaded: a key must learn nothing and change nothing.
    for (const route of SESSION_ONLY) {
      const text = source(route)
      const guard = text.search(/\bassertSession\(/)
      const firstUse = text.search(/readBody\(|readObjectBody\(|new Parse\.Query|useParse\(\)|getRouterParam\(|getQuery\(/)
      expect(guard, route).toBeGreaterThan(-1)
      if (firstUse !== -1) expect(guard < firstUse, `${route}: assertSession comes after the route starts working`).toBe(true)
    }
  })
})
