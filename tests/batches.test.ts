import { beforeEach, describe, expect, test } from 'bun:test'
import { collectAll, eachBatch, PARSE_MAX_LIMIT } from '../server/utils/batches'

// Reading past Parse's maxLimit (server/utils/batches.ts) against a fake
// query that remembers what it was asked.

type Fields = Record<string, unknown>
const table = new Map<string, Fields>()
const asked: { limit: number, after: string, keys: string[], order: string, skip: boolean }[] = []

class Row {
  className = 'Faq'
  constructor(public id: string, public fields: Fields) {}
  get(key: string) { return this.fields[key] }
}

class Query {
  max = 100
  after = ''
  keys: string[] = []
  order = ''
  skipped = false
  where: ((fields: Fields) => boolean)[] = []
  equalTo(key: string, value: unknown) { this.where.push(fields => fields[key] === value); return this }
  greaterThan(key: string, value: string) { if (key === 'objectId') this.after = value; return this }
  select(...keys: string[]) { this.keys.push(...keys); return this }
  ascending(key: string) { this.order = key; return this }
  skip() { this.skipped = true; return this }
  limit(n: number) { this.max = n; return this }
  async find() {
    asked.push({ limit: this.max, after: this.after, keys: this.keys, order: this.order, skip: this.skipped })
    // Parse caps what one find returns, whatever the limit says.
    const cap = Math.min(this.max, PARSE_MAX_LIMIT)
    return [...table].filter(([id, fields]) => id > this.after && this.where.every(test => test(fields))).sort(([a], [b]) => a.localeCompare(b)).slice(0, cap).map(([id, fields]) => new Row(id, fields))
  }
}

const id = (n: number) => `r${String(n).padStart(5, '0')}`
function fill(count: number, fields: (n: number) => Fields = () => ({})) {
  for (let n = 0; n < count; n++) table.set(id(n), fields(n))
}

beforeEach(() => {
  table.clear()
  asked.length = 0
})

describe('eachBatch', () => {
  test('pages by objectId until a short page, never asking for more than a batch', async () => {
    fill(1203)
    const seen: string[] = []
    const total = await eachBatch(() => new Query() as never, (rows) => { seen.push(...rows.map(row => row.id)) })
    expect(total).toBe(1203)
    expect(seen).toEqual([...table.keys()].sort())
    expect(asked.map(a => a.limit)).toEqual([500, 500, 500])
    expect(asked.map(a => a.after)).toEqual(['', id(499), id(999)])
    expect(asked.every(a => a.order === 'objectId' && !a.skip)).toBe(true)
  })

  test('a last page that comes out exactly full takes one more read to know it was the last', async () => {
    fill(1000)
    let pages = 0
    expect(await eachBatch(() => new Query() as never, () => { pages++ })).toBe(1000)
    expect(pages).toBe(2)
    expect(asked).toHaveLength(3)
    expect(asked.at(-1)!.after).toBe(id(999))
  })

  test('a batch never asks Parse for more than it returns at once', async () => {
    fill(2500)
    expect(await eachBatch(() => new Query() as never, () => {}, { batchSize: 5000 })).toBe(2500)
    expect(asked.map(a => a.limit)).toEqual([1000, 1000, 1000])
  })

  test('keeps the caller\'s filter and reads only the keys asked for', async () => {
    fill(30, n => ({ status: n % 3 ? 'active' : 'draft' }))
    const rows: string[] = []
    await eachBatch(() => new Query().equalTo('status', 'draft') as never, (page) => { rows.push(...page.map(row => row.id)) }, { batchSize: 4, keys: ['question'] })
    expect(rows).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27].map(id))
    expect(asked.every(a => a.keys.join() === 'question')).toBe(true)
  })

  test('the caller may delete each page as it comes without missing any', async () => {
    fill(1100)
    let deleted = 0
    await eachBatch(() => new Query() as never, (rows) => {
      for (const row of rows) table.delete(row.id)
      deleted += rows.length
    })
    expect(deleted).toBe(1100)
    expect(table.size).toBe(0)
  })

  test('nothing to read calls nothing', async () => {
    let calls = 0
    expect(await eachBatch(() => new Query() as never, () => { calls++ })).toBe(0)
    expect(calls).toBe(0)
  })
})

describe('collectAll', () => {
  test('everything, in batches, when it fits', async () => {
    fill(1500)
    const rows = await collectAll(() => new Query() as never, { max: 1500 })
    expect(rows).toHaveLength(1500)
    expect(asked.every(a => a.limit <= PARSE_MAX_LIMIT)).toBe(true)
  })

  test('more than max is an error, not a quiet cut', async () => {
    fill(1501)
    await expect(collectAll(() => new Query() as never, { max: 1500 })).rejects.toThrow('Too many Faq rows to load at once (more than 1500)')
  })
})
