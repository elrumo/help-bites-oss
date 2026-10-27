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
  'devices/[token].delete.ts',
  'oauth/authorize.post.ts',
  // Where data, mail and money go, and what an outside service may do for the workspace.
  'stripe/connect.post.ts',
  'stripe/index.delete.ts',
  'revenue/connect.post.ts',
  'revenue/index.delete.ts',
  'github/install.post.ts',
  'github/installations/[id].delete.ts',
  'errors/connect.post.ts',
  'errors/servers/index.post.ts',
  'errors/servers/[id].put.ts',
  'errors/servers/[id].delete.ts',
  'telegram/index.delete.ts',
  'projects/[id]/domains/index.post.ts',
  'projects/[id]/domains/[domainId].patch.ts',
  'projects/[id]/domains/[domainId].delete.ts',
  'projects/[id]/domains/[domainId]/verify.post.ts',
  'projects/[id]/inbound-addresses/index.post.ts',
  'projects/[id]/inbound-addresses/[addressId].delete.ts',
  'projects/[id]/inbound-addresses/[addressId]/verify.post.ts',
  'projects/[id]/webhooks/index.post.ts',
  'projects/[id]/webhooks/[wid].patch.ts',
  'projects/[id]/repos.put.ts',
  'contact-sources/index.get.ts',
  'contact-sources/index.post.ts',
  'contact-sources/test.post.ts',
  'contact-sources/[id].patch.ts',
  'contact-sources/[id].delete.ts',
  'contact-sources/[id]/run.post.ts',
  'transfers/index.post.ts',
  'transfers/inspect.post.ts',
  'transfers/upload.post.ts'
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

describe('a project\'s destinations are set in the panel', () => {
  test('the settings route refuses them to a key, before it changes anything', () => {
    const text = source('projects/[id].patch.ts')
    expect(text).toMatch(/if \(ctx\.apiKeyId\) refuseDestinationsToKeys\(body\)/)
    expect(text.indexOf('refuseDestinationsToKeys(')).toBeLessThan(text.indexOf('applyProjectInput('))
  })
})

describe('the MCP is for keys', () => {
  test('refuses a panel session before it does anything else', () => {
    const text = readFileSync(join(ROOT, 'server/routes/mcp.post.ts'), 'utf8')
    expect(text).toMatch(/if \(!identity\.apiKeyId\) throw createError\(\{ statusCode: 401/)
  })
})

describe('what a key learns about other workspaces', () => {
  test('nothing: me and the workspace list are cut to the key\'s own', () => {
    expect(readFileSync(join(ROOT, 'server/routes/v1/admin/me.get.ts'), 'utf8')).toContain('identity.apiKeyWorkspaceId')
    expect(readFileSync(join(ROOT, 'server/routes/v1/admin/workspaces/index.get.ts'), 'utf8')).toContain('apiKeyWorkspaceId')
  })

  test('the master email templates are the workspace\'s, so a project-limited key cannot read or rewrite them', () => {
    for (const route of ['emails/export.get.ts', 'emails/import.post.ts']) expect(source(route)).toMatch(/if \(!project\) assertWorkspaceWide\(ctx\)/)
  })
})
