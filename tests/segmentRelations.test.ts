import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

// The segment fields answered from other records (server/utils/segmentRelations.ts),
// against an in-memory stand-in for Parse and Redis. The real Parse singleton
// keeps its Query class swapped for the fake only while this file runs.

process.env.PARSE_ID ||= 'test'
process.env.PARSE_MASTER_KEY ||= 'test'
process.env.PARSE_URL ||= 'http://localhost:1/parse'

const { pointerId, useParse } = await import('../server/utils/parse')
const errorTracking = await import('../server/utils/errorTracking')
const relations = await import('../server/utils/segmentRelations')
const { compileSegmentFilter } = await import('../shared/segments')

type Fields = Record<string, unknown>
const db = new Map<string, Map<string, Fields>>()
const table = (className: string) => db.get(className) || db.set(className, new Map()).get(className)!
const put = (className: string, id: string, fields: Fields) => table(className).set(id, fields)
const ptr = (id: string) => ({ className: 'EndUser', id })

const same = (stored: unknown, wanted: unknown) => wanted && typeof wanted === 'object' ? pointerId(stored) === pointerId(wanted) : stored === wanted

class Row {
  constructor(public className: string, public id: string, public fields: Fields) {}
  get(key: string) { return this.fields[key] }
}

class FakeQuery {
  tests: ((fields: Fields, id: string) => boolean)[] = []
  max = 100
  constructor(public className: string) {}
  equalTo(key: string, value: unknown) { this.tests.push(f => same(f[key], value)); return this }
  containedIn(key: string, values: unknown[]) { this.tests.push(f => values.some(v => same(f[key], v))); return this }
  doesNotExist(key: string) { this.tests.push(f => f[key] === undefined); return this }
  greaterThan(_key: string, value: string) { this.tests.push((_f, id) => id > value); return this }
  select() { return this }
  ascending() { return this }
  limit(n: number) { this.max = n; return this }
  async find() {
    return [...table(this.className)].filter(([id, f]) => this.tests.every(t => t(f, id))).sort(([a], [b]) => a.localeCompare(b)).slice(0, this.max).map(([id, f]) => new Row(this.className, id, f))
  }
}

const parse = useParse() as unknown as { Query: unknown }
const realQuery = parse.Query
parse.Query = FakeQuery

const redisValues = new Map<string, string>()
const redisSets: { key: string, ttl: unknown }[] = []
const g = globalThis as Record<string, unknown>
g.__sbRedis = {
  get: async (key: string) => redisValues.get(key) ?? null,
  set: async (key: string, value: string, _ex: string, ttl: unknown) => { redisValues.set(key, value); redisSets.push({ key, ttl }) }
}

afterAll(() => {
  parse.Query = realQuery
  delete g.__sbRedis
})

const project = (errors?: Fields) => ({ id: 'P1', get: (key: string) => (key === 'errors' ? errors : key === 'name' ? 'Acme' : undefined) }) as any
const idsOf = (list: string[]) => [...list].sort()

beforeEach(() => {
  db.clear()
  redisValues.clear()
  redisSets.length = 0
})

describe('contacts with an open conversation', () => {
  test('open and waiting count; closed, archived and other projects do not', async () => {
    put('Conversation', 'c1', { project: { id: 'P1' }, endUser: ptr('ada'), statusCategory: 'open' })
    put('Conversation', 'c2', { project: { id: 'P1' }, endUser: ptr('ada'), statusCategory: 'pending' })
    put('Conversation', 'c3', { project: { id: 'P1' }, endUser: ptr('bob'), statusCategory: 'closed' })
    put('Conversation', 'c4', { project: { id: 'P1' }, endUser: ptr('cy'), statusCategory: 'open', archivedAt: new Date() })
    put('Conversation', 'c5', { project: { id: 'P2' }, endUser: ptr('dee'), statusCategory: 'open' })
    expect(await relations.contactsWithOpenConversation(project())).toEqual(['ada'])
  })

  test('a conversation with no contact is left out', async () => {
    put('Conversation', 'c1', { project: { id: 'P1' }, statusCategory: 'open' })
    expect(await relations.contactsWithOpenConversation(project())).toEqual([])
  })
})

describe('contacts who voted', () => {
  test('votes name the voter by external id, which is joined to this project\'s contacts', async () => {
    put('FeedbackVote', 'v1', { project: { id: 'P1' }, voterId: 'u_ada' })
    put('FeedbackVote', 'v2', { project: { id: 'P1' }, voterId: 'u_ada' })
    put('FeedbackVote', 'v3', { project: { id: 'P1' }, voterId: 'u_ghost' })
    put('FeedbackVote', 'v4', { project: { id: 'P2' }, voterId: 'u_bob' })
    put('EndUser', 'ada', { project: { id: 'P1' }, externalId: 'u_ada' })
    put('EndUser', 'bob-p1', { project: { id: 'P1' }, externalId: 'u_bob' })
    put('EndUser', 'bob-p2', { project: { id: 'P2' }, externalId: 'u_bob' })
    expect(await relations.contactsWhoVoted(project())).toEqual(['ada'])
  })
})

describe('contacts who finished onboarding', () => {
  test('skipping does not count', async () => {
    put('OnboardingCompletion', 'o1', { project: { id: 'P1' }, endUser: ptr('ada'), outcome: 'completed' })
    put('OnboardingCompletion', 'o2', { project: { id: 'P1' }, endUser: ptr('bob'), outcome: 'skipped' })
    put('OnboardingCompletion', 'o3', { project: { id: 'P1' }, endUser: ptr('ada'), outcome: 'completed', flow: 'pro' })
    put('OnboardingCompletion', 'o4', { project: { id: 'P2' }, endUser: ptr('cy'), outcome: 'completed' })
    expect(await relations.contactsWhoFinishedOnboarding(project())).toEqual(['ada'])
  })
})

describe('the cap', () => {
  test('past the cap the lookup fails instead of matching only part of the project', async () => {
    for (let i = 0; i <= relations.RELATION_CAP; i++) put('OnboardingCompletion', `o${String(i).padStart(6, '0')}`, { project: { id: 'P1' }, endUser: ptr(`u${i}`), outcome: 'completed' })
    await expect(relations.contactsWhoFinishedOnboarding(project())).rejects.toThrow(/Too many/)
  })
})

describe('errorEventUserId', () => {
  test('finds the user id wherever a tracker puts it', () => {
    expect(relations.errorEventUserId({ user: { id: 'u_1' } })).toBe('u_1')
    expect(relations.errorEventUserId({ context: { user: { id: 'u_2' } } })).toBe('u_2')
    expect(relations.errorEventUserId({ contexts: { user: { id: 'u_3' } } })).toBe('u_3')
    expect(relations.errorEventUserId({ data: { user: { id: 'u_4' } } })).toBe('u_4')
    expect(relations.errorEventUserId({ entries: [{ type: 'message', data: {} }, { type: 'user', data: { id: 'u_5' } }] })).toBe('u_5')
  })

  test('a numeric id becomes text; a missing, empty or odd one is no one', () => {
    expect(relations.errorEventUserId({ user: { id: 42 } })).toBe('42')
    expect(relations.errorEventUserId({ user: { email: 'a@b.co' } })).toBe('')
    expect(relations.errorEventUserId({ user: { id: { nested: true } } })).toBe('')
    expect(relations.errorEventUserId({ user: null })).toBe('')
    expect(relations.errorEventUserId(null)).toBe('')
    expect(relations.errorEventUserId('boom')).toBe('')
    expect(relations.errorEventUserId(undefined)).toBe('')
  })
})

describe('contacts with errors', () => {
  const connected = { provider: 'glitchtip', dsn: 'https://key@errors.example.com/1' }
  const issue = (id: string) => ({ id, provider: 'glitchtip', linkId: 'main' })
  let listed: { status?: string, limit?: number }[] = []
  let latestFor: Record<string, unknown> = {}
  let issues: ReturnType<typeof issue>[] = []

  const spies = [
    spyOn(errorTracking, 'listIssues').mockImplementation((async (_project: unknown, input: { status?: string, limit?: number }) => { listed.push(input); return { issues, next: '' } }) as any),
    spyOn(errorTracking, 'latestErrorEvent').mockImplementation((async (_project: unknown, _provider: unknown, issueId: string) => {
      if (latestFor[issueId] instanceof Error) throw latestFor[issueId]
      return latestFor[issueId]
    }) as any)
  ]
  afterAll(() => spies.forEach(spy => spy.mockRestore()))

  beforeEach(() => {
    listed = []
    issues = [issue('i1'), issue('i2'), issue('i3')]
    latestFor = { i1: { user: { id: 'u_ada' } }, i2: { user: { id: 'u_ada' } }, i3: { user: { id: 'u_bob' } } }
  })

  test('no tracker connected means nobody, and the tracker is never asked', async () => {
    expect(await relations.errorUserExternalIds(project())).toEqual([])
    expect(await relations.errorUserExternalIds(project({ provider: 'glitchtip' }))).toEqual([])
    expect(listed).toEqual([])
  })

  test('the people hit by the newest open issues, once each', async () => {
    expect(idsOf(await relations.errorUserExternalIds(project(connected)))).toEqual(['u_ada', 'u_bob'])
    expect(listed).toEqual([{ status: 'unresolved', limit: 50 }])
  })

  test('only the newest 50 issues are looked at', async () => {
    issues = Array.from({ length: 60 }, (_, i) => issue(`n${i}`))
    latestFor = Object.fromEntries(issues.map((x, i) => [x.id, { user: { id: `u_${i}` } }]))
    const found = await relations.errorUserExternalIds(project(connected))
    expect(found).toHaveLength(50)
    expect(found).not.toContain('u_50')
  })

  test('an issue whose event cannot be read, or has no user, is skipped without failing the rest', async () => {
    latestFor.i1 = new Error('tracker down')
    latestFor.i2 = { message: 'no user here' }
    expect(await relations.errorUserExternalIds(project(connected))).toEqual(['u_bob'])
  })

  test('the answer is cached for ten minutes and the cache is used', async () => {
    await relations.errorUserExternalIds(project(connected))
    expect(redisSets).toEqual([{ key: 'sb:errusers:P1', ttl: 600 }])
    listed = []
    latestFor = {}
    expect(idsOf(await relations.errorUserExternalIds(project(connected)))).toEqual(['u_ada', 'u_bob'])
    expect(listed).toEqual([])
  })

  test('the ids become this project\'s contacts', async () => {
    put('EndUser', 'ada', { project: { id: 'P1' }, externalId: 'u_ada' })
    put('EndUser', 'bob-other-project', { project: { id: 'P2' }, externalId: 'u_bob' })
    expect(await relations.contactsWithErrors(project(connected))).toEqual(['ada'])
  })
})

describe('resolving a segment', () => {
  test('only the lookups the filter uses are made, and they fill the where', async () => {
    put('Conversation', 'c1', { project: { id: 'P1' }, endUser: ptr('ada'), statusCategory: 'open' })
    put('OnboardingCompletion', 'o1', { project: { id: 'P1' }, endUser: ptr('bob'), outcome: 'completed' })
    const filter = { match: 'all' as const, rules: [{ field: 'hasOpenConversation', op: 'is' as const, value: 'yes' }, { field: 'finishedOnboarding', op: 'is' as const, value: 'no' }, { field: 'tags', op: 'includes' as const, value: 'beta' }] }
    expect(await relations.resolveRelations(project(), filter)).toEqual({ hasOpenConversation: ['ada'], finishedOnboarding: ['bob'] })
    expect(await relations.resolveSegmentWhere(project(), filter)).toEqual({ $and: [{ objectId: { $in: ['ada'] } }, { objectId: { $nin: ['bob'] } }, { tags: 'beta' }] })
  })

  test('a filter with no relation fields makes no lookups', async () => {
    expect(await relations.resolveRelations(project(), { match: 'all', rules: [{ field: 'tags', op: 'includes', value: 'beta' }] })).toEqual({})
  })

  test('compiling a relation rule without its lookup is an error, not "everyone"', () => {
    expect(() => compileSegmentFilter({ match: 'all', rules: [{ field: 'votedOnPost', op: 'is', value: 'yes' }] })).toThrow(/looked up first/)
  })
})
