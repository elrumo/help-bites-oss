import { describe, expect, test } from 'bun:test'
import { collectAll } from '../server/utils/batches'
import { releaseProgress } from '../server/utils/board'

// A release is a changelog release, and its progress is worked out from the board cards that name it:
// board.ts leans on nitro's auto-imports and Parse, so stub the few it calls and run it on in-memory rows.

type Fields = Record<string, unknown>
const g = globalThis as Record<string, any>

class FakeRow {
  constructor(public id: string, public fields: Fields) {}
  get(key: string) { return this.fields[key] }
}

let rows: FakeRow[] = []

class Query {
  private equal: [string, unknown][] = []
  private contained: [string, unknown[]][] = []
  constructor(private className: string) {}
  equalTo(field: string, value: unknown) { this.equal.push([field, value]); return this }
  containedIn(field: string, values: unknown[]) { this.contained.push([field, values]); return this }
  select() { return this }
  ascending() { return this }
  greaterThan() { return this }
  limit() { return this }
  async find() {
    return rows.filter(row => row.fields.__class === this.className
      && this.equal.every(([field, value]) => row.get(field) === value)
      && this.contained.every(([field, values]) => values.includes(row.get(field))))
  }
}

g.useParse = () => ({ Query })
g.collectAll = collectAll

const project = { id: 'p1', get: (key: string) => (key === 'board' ? undefined : undefined) } as any
const otherProject = { id: 'p2', get: () => undefined } as any

describe('release progress', () => {
  test('counts the cards that name each release, by count and by points, in this project only', async () => {
    rows = [
      new FakeRow('k1', { __class: 'BoardItem', project, releaseId: 'rel1', status: 'done', estimate: 3 }),
      new FakeRow('k2', { __class: 'BoardItem', project, releaseId: 'rel1', status: 'planned', estimate: 2 }),
      new FakeRow('k3', { __class: 'BoardItem', project, releaseId: 'rel2', status: 'done' }),
      new FakeRow('k4', { __class: 'BoardItem', project: otherProject, releaseId: 'rel1', status: 'done', estimate: 5 })
    ]
    const progress = await releaseProgress(project, ['rel1', 'rel2', 'rel3'])
    expect(progress.get('rel1')).toEqual({ total: 2, done: 1, estimateTotal: 5, estimateDone: 3 })
    expect(progress.get('rel2')).toEqual({ total: 1, done: 1, estimateTotal: 0, estimateDone: 0 })
    expect(progress.has('rel3')).toBe(false)
  })

  test('asks for nothing when there are no releases', async () => {
    expect((await releaseProgress(project, [])).size).toBe(0)
  })
})
