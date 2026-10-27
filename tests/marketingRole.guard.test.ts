import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// shared/roles.ts: an agent answers the inbox and edits content; marketing (campaigns, sequences, sending mail, erasing
// people) is for admins, and the /v1/admin twins of these routes already ask for it. The /v1 routes serve operators and a
// project secret alike: callerProject lets the secret through (the host's own server) and applies `can` to operators.

const ROUTES = join(import.meta.dir, '../server/routes/v1')

const MARKETING = [
  'campaigns/index.post.ts',
  'campaigns/[id].patch.ts',
  'campaigns/[id].delete.ts',
  'campaigns/[id]/test.post.ts',
  'sequences/index.post.ts',
  'sequences/[id].patch.ts',
  'sequences/[id].delete.ts',
  'sequences/[id]/enrollments.post.ts',
  'emails/send.post.ts',
  'email-suppressions/index.post.ts',
  'email-suppressions/[email].delete.ts',
  'contacts/[id].delete.ts',
  'segments/index.post.ts',
  'segments/[id].patch.ts',
  'segments/[id].delete.ts',
  'automations/recipes/[id]/install.post.ts'
]

describe('routes that send mail, erase people or run campaigns', () => {
  test('ask an operator for the marketing role', () => {
    const missing = MARKETING.filter(route => !/callerProject\([^)]*\{ can: 'marketing' \}\)/.test(readFileSync(join(ROUTES, route), 'utf8')))
    expect(missing).toEqual([])
  })
})
