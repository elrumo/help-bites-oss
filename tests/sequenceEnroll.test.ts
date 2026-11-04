import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

// Putting people on a sequence by hand (server/utils/sequences.ts enrollContactIds / enrollSegment),
// against an in-memory stand-in for Parse and Redis, swapped in only while this file runs.

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'
process.env.PARSE_ID ||= 'test'
process.env.PARSE_MASTER_KEY ||= 'test'
process.env.PARSE_URL ||= 'http://localhost:1/parse'

const { pointerId, useParse } = await import('../server/utils/parse')
const { ENROLL_SEGMENT_CAP, enrollContactIds, enrollSegment } = await import('../server/utils/sequences')

type Fields = Record<string, any>
const db = new Map<string, Map<string, Fields>>()
const table = (className: string) => db.get(className) || db.set(className, new Map()).get(className)!
let serial = 0

// Enrollments are only ever written by save(), and createEnrollment looks each contact up by (sequence, contact): without an index
// that is a scan of every enrollment per contact, 12 million row tests for a 5000-person segment.
const byPointer = new Map<string, Set<string>>()
const indexKey = (className: string, key: string, id: string) => `${className}|${key}|${id}`

const same = (stored: unknown, wanted: unknown) => wanted && typeof wanted === 'object' ? pointerId(stored) === pointerId(wanted) : stored === wanted
const holds = (stored: unknown, wanted: unknown) => Array.isArray(stored) ? stored.some(v => same(v, wanted)) : same(stored, wanted)

/** The compiled segments these tests use: equality (an array holds the value), $in, $nin, and $and. */
function matches(fields: Fields, id: string, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (key === '$and') return (want as Record<string, any>[]).every(w => matches(fields, id, w))
    const have = key === 'objectId' ? id : fields[key]
    if (want && typeof want === 'object' && '$in' in want) return (want.$in as unknown[]).some(v => holds(have, v))
    if (want && typeof want === 'object' && '$nin' in want) return !(want.$nin as unknown[]).some(v => holds(have, v))
    return holds(have, want)
  })
}

class Row {
  constructor(public className: string, public id: string, public fields: Fields) {}
  get(key: string) { return this.fields[key] }
  set(key: string, value: unknown) { this.fields[key] = value }
  increment(key: string, by: number) { this.fields[key] = (this.fields[key] || 0) + by }
  async save() {
    table(this.className).set(this.id, this.fields)
    if (this.className === 'SequenceEnrollment') {
      for (const key of ['sequence', 'contact']) {
        const k = indexKey(this.className, key, pointerId(this.fields[key]))
        byPointer.set(k, (byPointer.get(k) || new Set()).add(this.id))
      }
    }
  }
}

class FakeQuery {
  tests: ((fields: Fields, id: string) => boolean)[] = []
  pointers: [string, string][] = []
  max = 100
  constructor(public className: string) {}
  static fromJSON(className: string, json: { where: Record<string, any> }) {
    const query = new FakeQuery(className)
    query.tests.push((f, id) => matches(f, id, json.where))
    return query
  }

  equalTo(key: string, value: unknown) {
    // The wanted pointer's id is read once, not per row: the enroll tests scan thousands of rows thousands of times.
    const wanted = value && typeof value === 'object' ? pointerId(value) : value
    if (wanted !== value) this.pointers.push([key, String(wanted)])
    const is = (stored: unknown) => (wanted !== value ? pointerId(stored) === wanted : stored === wanted)
    this.tests.push((f, id) => (key === 'objectId' ? id === value : Array.isArray(f[key]) ? f[key].some(is) : is(f[key])))
    return this
  }
  notEqualTo(key: string, value: unknown) { this.tests.push(f => !holds(f[key], value)); return this }
  // A Set, not values.some per row: a page of 200 against thousands of enrollments is otherwise millions of comparisons.
  containedIn(key: string, values: unknown[]) {
    const wanted = new Set(values.map(v => (v && typeof v === 'object' ? pointerId(v) : v)))
    this.tests.push((f, id) => (key === 'objectId' ? wanted.has(id) : wanted.has(f[key] && typeof f[key] === 'object' ? pointerId(f[key]) : f[key])))
    return this
  }
  notContainedIn(key: string, values: unknown[]) { this.tests.push(f => !values.some(v => same(f[key], v))); return this }
  greaterThan(_key: string, value: string) { this.tests.push((_f, id) => id > value); return this }
  select() { return this }
  ascending() { return this }
  limit(n: number) { this.max = n; return this }
  /** The rows to test: those holding every wanted pointer when the class is indexed, else all of them. */
  private candidates(): [string, Fields][] {
    if (this.className !== 'SequenceEnrollment' || !this.pointers.length) return [...table(this.className)]
    const sets = this.pointers.map(([key, id]) => byPointer.get(indexKey(this.className, key, id)) || new Set<string>())
    const smallest = sets.reduce((a, b) => (b.size < a.size ? b : a))
    return [...smallest].map(id => [id, table(this.className).get(id)!])
  }

  private rows() { return this.candidates().filter(([id, f]) => this.tests.every(t => t(f, id))).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, f]) => new Row(this.className, id, f)) }
  async find() { return this.rows().slice(0, this.max) }
  // Existence is all the callers ask of first(), so it stops at the first match instead of sorting every row.
  async first() { for (const [id, f] of this.candidates()) if (this.tests.every(t => t(f, id))) return new Row(this.className, id, f) }
  async count() { return this.rows().length }
}

const Parse = useParse() as any
const realQuery = Parse.Query
const realExtend = Parse.Object.extend
Parse.Query = FakeQuery
Parse.Object.extend = (className: string) => class { constructor() { return new Row(className, `${className}_${String(++serial).padStart(7, '0')}`, {}) } }

const g = globalThis as Record<string, unknown>
g.__sbRedis = { set: async () => 'OK', eval: async () => 1 }

afterAll(() => {
  Parse.Query = realQuery
  Parse.Object.extend = realExtend
  delete g.__sbRedis
})

const project = { id: 'P1', get: () => undefined } as any
const ptr = (className: string, id: string) => ({ className, id })

let sequence: Row
function person(id: string, fields: Fields = {}) {
  table('EndUser').set(id, { project: ptr('Project', 'P1'), subscription: 'subscribed', tags: [], unsubscribedTopics: [], ...fields })
}
const enrolled = () => [...table('SequenceEnrollment').values()].map(f => pointerId(f.contact)).sort()

beforeEach(() => {
  db.clear()
  byPointer.clear()
  serial = 0
  sequence = new Row('Sequence', 'S1', { project: ptr('Project', 'P1'), status: 'active', steps: [{ id: 'a', template: 't', delayMinutes: 0 }], trigger: { type: 'manual' } })
  table('Sequence').set('S1', sequence.fields)
  table('ContactSegment').set('seg1', { project: ptr('Project', 'P1'), name: 'Beta', filter: { match: 'all', rules: [{ field: 'tags', op: 'includes', value: 'beta' }] } })
  table('ContactSegment').set('everyone', { project: ptr('Project', 'P1'), name: 'Everyone', filter: { match: 'all', rules: [] } })
})

describe('enrolling by id', () => {
  test('subscribed contacts are enrolled; the rest are counted by reason', async () => {
    person('ada')
    person('bob', { subscription: 'unsubscribed' })
    person('cy', { project: ptr('Project', 'P2') })
    expect(await enrollContactIds(project, sequence as any, ['ada', 'bob', 'cy', 'nobody'])).toEqual({ enrolled: 1, skipped: { notSubscribed: 1, optedOut: 0, alreadyEnrolled: 0, notFound: 2 }, truncated: false })
    expect(enrolled()).toEqual(['ada'])
    expect(sequence.get('enrolledCount')).toBe(1)
    expect(sequence.get('activeCount')).toBe(1)
  })

  test('asking again enrolls nobody twice', async () => {
    person('ada')
    await enrollContactIds(project, sequence as any, ['ada'])
    const again = await enrollContactIds(project, sequence as any, ['ada', 'ada'])
    expect(again.enrolled).toBe(0)
    expect(again.skipped.alreadyEnrolled).toBe(1)
    expect(enrolled()).toEqual(['ada'])
  })
})

describe('enrolling a segment', () => {
  test('everyone in it who is subscribed; the others are counted, nobody outside it is touched', async () => {
    person('ada', { tags: ['beta'] })
    person('bob', { tags: ['beta'] })
    person('cy', { tags: ['beta'], subscription: 'unsubscribed' })
    person('dee', { tags: ['beta'], subscription: 'pending' })
    person('eve', { tags: ['other'] })
    const result = await enrollSegment(project, sequence as any, 'seg1')
    expect(result).toEqual({ enrolled: 2, skipped: { notSubscribed: 2, optedOut: 0, alreadyEnrolled: 0, notFound: 0 }, truncated: false })
    expect(enrolled()).toEqual(['ada', 'bob'])
  })

  test('a segment of another project, or a missing one, is a 404', async () => {
    table('ContactSegment').set('theirs', { project: ptr('Project', 'P2'), name: 'Theirs', filter: { match: 'all', rules: [] } })
    for (const id of ['theirs', 'missing']) await expect(enrollSegment(project, sequence as any, id)).rejects.toMatchObject({ statusCode: 404 })
  })

  test('for a topic sequence, people who opted out of the topic are skipped and counted', async () => {
    sequence.set('trigger', { type: 'manual', topic: 'news' })
    person('ada')
    person('bob', { unsubscribedTopics: ['news'] })
    person('cy', { unsubscribedTopics: ['other'] })
    const result = await enrollSegment(project, sequence as any, 'everyone')
    expect(result.enrolled).toBe(2)
    expect(result.skipped.optedOut).toBe(1)
    expect(enrolled()).toEqual(['ada', 'cy'])
  })

  test('people already on the sequence are skipped, and the counts add up', async () => {
    person('ada')
    person('bob')
    await enrollContactIds(project, sequence as any, ['ada'])
    const result = await enrollSegment(project, sequence as any, 'everyone')
    expect(result.enrolled).toBe(1)
    expect(result.skipped.alreadyEnrolled).toBe(1)
    expect(sequence.get('enrolledCount')).toBe(2)
  })

  test('one call enrolls at most the cap and says there is more; the next call carries on past the people already on it', async () => {
    const total = ENROLL_SEGMENT_CAP + 120
    for (let i = 0; i < total; i++) person(`u${String(i).padStart(5, '0')}`)
    const first = await enrollSegment(project, sequence as any, 'everyone')
    expect(first.enrolled).toBe(ENROLL_SEGMENT_CAP)
    expect(first.truncated).toBe(true)
    const second = await enrollSegment(project, sequence as any, 'everyone')
    expect(second.enrolled).toBe(120)
    expect(second.skipped.alreadyEnrolled).toBe(ENROLL_SEGMENT_CAP)
    expect(second.truncated).toBe(false)
    expect(enrolled()).toHaveLength(total)
    expect(sequence.get('enrolledCount')).toBe(total)
  })

  test('a segment of exactly the cap is not reported as cut short', async () => {
    for (let i = 0; i < ENROLL_SEGMENT_CAP; i++) person(`u${String(i).padStart(5, '0')}`)
    const result = await enrollSegment(project, sequence as any, 'everyone')
    expect(result.enrolled).toBe(ENROLL_SEGMENT_CAP)
    expect(result.truncated).toBe(false)
  })
})
