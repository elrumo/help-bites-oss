import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import Redis from 'ioredis'
import { definePlan } from '../shared/entitlements'
import { pointerId } from '../server/utils/parse'
import * as editionModule from '../server/utils/edition'

// The counters are one Lua script in Redis, so they are tested against a
// real one: REDIS_TEST_URL when set (CI's service container; use a database
// of its own, e.g. /15, since every test empties it), else a throwaway
// redis-server on a spare port. With neither, these tests are skipped.

const TEST_URL = process.env.REDIS_TEST_URL || ''
const hasRedis = !!TEST_URL || Bun.which('redis-server') !== null
const port = 30_000 + Math.floor(Math.random() * 20_000)
let server: ReturnType<typeof Bun.spawn> | null = null
let redis: Redis

// Persisted counters (WorkspaceUsage) and what flushUsage writes.
let persisted: Record<string, number> = {}
const saved: Record<string, unknown>[] = []
// What `find` returns per class, and the bucket, for the storage breakdown.
let rows: Record<string, { id: string, get: (key: string) => unknown }[]> = {}
let bucket: { name: string, size: number }[] = []

class Query {
  private filters: Record<string, unknown> = {}
  constructor(private className: string) {}
  equalTo(key: string, value: unknown) {
    this.filters[key] = value
    return this
  }

  select() { return this }
  limit() { return this }
  doesNotExist() { return this }
  async find() { return rows[this.className] || [] }

  async first() {
    if (this.className !== 'WorkspaceUsage') return undefined
    const key = `${pointerId(this.filters.workspace)}:${this.filters.period}:${this.filters.metric}`
    return key in persisted ? { get: () => persisted[key], set: () => {}, save: async () => {} } : undefined
  }
}
class UsageRow {
  fields: Record<string, unknown> = {}
  set(key: string, value: unknown) {
    this.fields[key] = value
  }

  async save() {
    saved.push(this.fields)
  }
}

const g = globalThis as Record<string, unknown>
Object.assign(g, editionModule)
g.pointerId = pointerId
g.MASTER = {}
g.useRedis = () => redis
g.s3Configured = () => true
g.listStoredObjects = async function* (prefix: string) { for (const item of bucket) if (item.name.startsWith(prefix)) yield item }
g.getWorkspace = async (id: string) => ({ id, get: () => undefined })
g.useParse = () => ({ Query, Object: { extend: (name: string) => (name === 'WorkspaceUsage' ? UsageRow : { createWithoutData: (id: string) => ({ id }) }) } })

const usage = await import('../server/utils/usage')
const { reserveUsage, chargeUsage, readUsage, flushUsage, usageKey, usagePeriod } = usage

const capped = (limits: Record<string, number>, soft: Record<string, boolean> = {}) => definePlan({ id: 'free', name: 'Free', limits, soft })

beforeAll(async () => {
  if (!hasRedis) return
  if (!TEST_URL) server = Bun.spawn(['redis-server', '--port', String(port), '--save', '', '--appendonly', 'no'], { stdout: 'ignore', stderr: 'ignore' })
  redis = new Redis(TEST_URL || `redis://127.0.0.1:${port}`, { maxRetriesPerRequest: 1, retryStrategy: times => (times > 50 ? null : 100) })
  // Refused until the server is up; the loop below waits for that.
  redis.on('error', () => {})
  for (let i = 0; i < 50; i++) {
    if (await redis.ping().catch(() => null) === 'PONG') break
    await Bun.sleep(100)
  }
})

afterAll(async () => {
  editionModule.resetEdition()
  await redis?.quit().catch(() => {})
  server?.kill()
})

beforeEach(async () => {
  editionModule.resetEdition()
  persisted = {}
  saved.length = 0
  // Only this connection's own database: never anything else on a shared Redis.
  if (hasRedis) await redis.flushdb()
})

describe.skipIf(!hasRedis)('usage counters', () => {
  test('counts up to the limit, then refuses with what ran out', async () => {
    editionModule.registerEdition({ id: 'cloud', planFor: () => capped({ conversations: 3 }) })
    for (let i = 0; i < 3; i++) await reserveUsage('W1', 'conversations')
    const error = await reserveUsage('W1', 'conversations').then(() => null, e => e)
    expect(error?.statusCode).toBe(402)
    expect(error?.data).toEqual({ code: 'plan_limit', metric: 'conversations', limit: 3, used: 3, plan: 'free' })
    expect(await readUsage('W1', 'conversations')).toBe(3)
    // Another workspace has its own count.
    await reserveUsage('W2', 'conversations')
    expect(await readUsage('W2', 'conversations')).toBe(1)
  })

  test('two replicas racing for the last ones never pass the limit together', async () => {
    editionModule.registerEdition({ id: 'cloud', planFor: () => capped({ emails: 5 }) })
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveUsage('W1', 'emails').then(() => true, () => false)))
    expect(results.filter(Boolean)).toHaveLength(5)
    expect(await readUsage('W1', 'emails')).toBe(5)
  })

  test('a batch that would not fit is refused whole', async () => {
    editionModule.registerEdition({ id: 'cloud', planFor: () => capped({ emails: 10 }) })
    await reserveUsage('W1', 'emails', 8)
    await expect(reserveUsage('W1', 'emails', 3)).rejects.toMatchObject({ statusCode: 402 })
    expect(await readUsage('W1', 'emails')).toBe(8)
  })

  test('a soft limit counts but never refuses', async () => {
    editionModule.registerEdition({ id: 'cloud', planFor: () => capped({ conversations: 1 }, { conversations: true }) })
    await reserveUsage('W1', 'conversations')
    await reserveUsage('W1', 'conversations')
    expect(await readUsage('W1', 'conversations')).toBe(2)
  })

  test('the community edition counts and never refuses', async () => {
    for (let i = 0; i < 50; i++) await reserveUsage('W1', 'emails')
    expect(await readUsage('W1', 'emails')).toBe(50)
  })

  test('giving usage back never goes below zero', async () => {
    await chargeUsage('W1', 'storageBytes', 100)
    await chargeUsage('W1', 'storageBytes', -250)
    expect(await readUsage('W1', 'storageBytes')).toBe(0)
  })

  test('a counter Redis lost starts again from what was saved', async () => {
    editionModule.registerEdition({ id: 'cloud', planFor: () => capped({ aiCredits: 10 }) })
    persisted[`W1:${usagePeriod('aiCredits')}:aiCredits`] = 9
    await reserveUsage('W1', 'aiCredits')
    await expect(reserveUsage('W1', 'aiCredits')).rejects.toMatchObject({ statusCode: 402 })
    expect(await redis.get(usageKey('W1', 'aiCredits'))).toBe('10')
  })

  test('monthly keys expire, storage does not, and the period is in the key', async () => {
    await reserveUsage('W1', 'emailsPerDay')
    await chargeUsage('W1', 'storageBytes', 10)
    expect(await redis.ttl(usageKey('W1', 'emailsPerDay'))).toBeGreaterThan(0)
    expect(await redis.ttl(usageKey('W1', 'storageBytes'))).toBe(-1)
    expect(usageKey('W1', 'emailsPerDay')).toMatch(/^sb:usage:W1:\d{4}-\d{2}-\d{2}:emailsPerDay$/)
    expect(usageKey('W1', 'emails')).toMatch(/^sb:usage:W1:\d{4}-\d{2}:emails$/)
  })

  test('flushing copies changed counters out once', async () => {
    await reserveUsage('W1', 'conversations', 4)
    await chargeUsage('W2', 'storageBytes', 2048)
    expect(await flushUsage()).toBe(2)
    expect(saved).toContainEqual({ workspace: { id: 'W1' }, period: usagePeriod('conversations'), metric: 'conversations', value: 4 })
    expect(saved).toContainEqual({ workspace: { id: 'W2' }, period: 'all', metric: 'storageBytes', value: 2048 })
    expect(await flushUsage()).toBe(0)
  })
})

describe('usage keys', () => {
  test('parse back into workspace, period and metric', () => {
    expect(usage.parseUsageKey('sb:usage:W1:2026-10:emails')).toEqual({ workspaceId: 'W1', period: '2026-10', metric: 'emails' })
    expect(usage.parseUsageKey('sb:usage:W1:all:storageBytes')).toEqual({ workspaceId: 'W1', period: 'all', metric: 'storageBytes' })
    expect(usage.parseUsageKey('sb:usage:W1:2026-10:projects')).toBeNull()
  })

  test('the period is the UTC month, or day for the daily cap', () => {
    const now = new Date('2026-10-31T23:30:00Z')
    expect(usagePeriod('emails', now)).toBe('2026-10')
    expect(usagePeriod('emailsPerDay', now)).toBe('2026-10-31')
    expect(usagePeriod('storageBytes', now)).toBe('all')
  })
})

describe('storage breakdown', () => {
  test('a key says what the file is', () => {
    const cases: Record<string, string> = {
      'P1/Eu12ab34cd/x.png': 'conversations',
      'P1/email-Eu12ab34cd/x.pdf': 'conversations',
      'P1/u-0123456789abcdef/x.pdf': 'feedback',
      'P1/agent-Ag1/x.png': 'team',
      'P1/brand/x.svg': 'branding',
      'P1/cms/x.webp': 'cms',
      'P1/forms/F1/x.pdf': 'forms',
      'P1/emails/x.png': 'emails',
      'emails/T1/x.png': 'emails',
      'P1/blog/x.avif': 'blog',
      'P1/onboarding/x.png': 'onboarding',
      'knowledge/K1/x.md': 'knowledge',
      'imports/W1/abc123/P0/brand/x.png': 'branding',
      'imports/W1/abc123/knowledge/K0/x.md': 'knowledge',
      'P1/x.png': 'other'
    }
    expect(Object.fromEntries(Object.keys(cases).map(key => [key, usage.storageType(key)]))).toEqual(cases)
  })

  test('adds up by type and project, with workspace-wide files last', async () => {
    rows = {
      Project: [{ id: 'P1', get: () => 'Small' }, { id: 'P2', get: () => 'Big' }, { id: 'P3', get: () => 'Empty' }],
      KnowledgeModel: [{ id: 'K1', get: () => undefined }, { id: 'K2', get: () => ({ id: 'P1' }) }],
      EmailTemplate: []
    }
    bucket = [
      { name: 'P1/brand/a.png', size: 100 },
      { name: 'P2/Eu1/b.png', size: 3000 },
      { name: 'P2/Eu2/c.png', size: 1000 },
      { name: 'P2/brand/d.png', size: 50 },
      { name: 'knowledge/K1/e.md', size: 500 },
      { name: 'knowledge/K2/g.md', size: 200 },
      { name: 'POTHER/brand/f.png', size: 9999 }
    ]
    const result = await usage.storageBreakdown('W1')
    expect(result).toMatchObject({ used: 0, limit: null, bytes: 4850, files: 6 })
    expect(result.types).toEqual([
      { type: 'conversations', bytes: 4000, files: 2 },
      { type: 'knowledge', bytes: 700, files: 2 },
      { type: 'branding', bytes: 150, files: 2 }
    ])
    // P1's own knowledge model counts there; the shared one is the workspace's.
    expect(result.projects.map(p => [p.id, p.bytes])).toEqual([['P2', 4050], ['P1', 300], ['P3', 0], [null, 500]])
    expect(result.projects[0]!.types).toEqual({ conversations: 4000, branding: 50 })
  })
})
