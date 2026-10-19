import { beforeEach, describe, expect, test } from 'bun:test'
import { pointerId } from '../server/utils/parse'

// A suspended (or deleting) workspace is closed to the public: its projects'
// public keys and secrets stop working, as if they did not exist.

const projects = [
  { id: 'p1', fields: { publicKey: 'pk_susp_live', secret: 'sk_susp_live', workspace: { id: 'live' } } },
  { id: 'p2', fields: { publicKey: 'pk_susp_closed', secret: 'sk_susp_closed', workspace: { id: 'closed' } } }
]
let closed = new Set<string>()
let rateLimited: string[] = []

class Query {
  key = ''
  value: unknown
  constructor(public className: string) {}
  equalTo(key: string, value: unknown) { this.key = key; this.value = value; return this }
  async first() {
    const row = projects.find(p => (p.fields as Record<string, unknown>)[this.key] === this.value)
    return row ? { id: row.id, get: (k: string) => (row.fields as Record<string, unknown>)[k] } : undefined
  }
}

const g = globalThis as Record<string, unknown>
Object.assign(g, {
  useParse: () => ({ Query }),
  MASTER: {},
  pointerId,
  workspaceIsActive: async (id: string) => !closed.has(id),
  rateLimit: async (key: string) => { rateLimited.push(key) },
  LIMITS: { requestsPerProject: { limit: 100, window: 60 } }
})

const { findProjectByPublicKey } = await import('../server/utils/projects')
const { requireProjectSecret } = await import('../server/utils/auth')

const withBearer = (token: string) => ({ node: { req: { headers: { authorization: `Bearer ${token}` } } } }) as any
const statusOf = async (promise: Promise<unknown>) => promise.then(() => 0, (error: { statusCode?: number, statusMessage?: string }) => `${error.statusCode} ${error.statusMessage}`)

beforeEach(() => {
  closed = new Set()
  rateLimited = []
})

describe('a suspended workspace', () => {
  test('its public keys find nothing, even when the project is cached', async () => {
    expect((await findProjectByPublicKey('pk_susp_closed'))?.id).toBe('p2')
    closed.add('closed')
    expect(await findProjectByPublicKey('pk_susp_closed')).toBeNull()
    expect((await findProjectByPublicKey('pk_susp_live'))?.id).toBe('p1')
    closed.delete('closed')
    expect((await findProjectByPublicKey('pk_susp_closed'))?.id).toBe('p2')
  })

  test('its project secrets answer like a wrong one', async () => {
    expect((await requireProjectSecret(withBearer('sk_susp_closed'))).id).toBe('p2')
    closed.add('closed')
    expect(await statusOf(requireProjectSecret(withBearer('sk_susp_closed')))).toBe('401 Invalid project secret')
    expect(await statusOf(requireProjectSecret(withBearer('sk_nobody')))).toBe('401 Invalid project secret')
    expect((await requireProjectSecret(withBearer('sk_susp_live'))).id).toBe('p1')
    expect(rateLimited).toEqual(['sb:rl:project:p2', 'sb:rl:project:p1'])
  })
})
