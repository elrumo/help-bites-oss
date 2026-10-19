import { beforeEach, describe, expect, test } from 'bun:test'

const g = globalThis as Record<string, unknown>
g.MASTER = {}
let failParse = false
const published: string[] = []
g.useRedis = () => ({ publish: async (_channel: string, message: string) => { published.push(message) } })
class Row {
  fields: Record<string, unknown>
  saves = 0
  constructor(fields: Record<string, unknown> = {}) {
    this.fields = { ...fields }
  }

  get(key: string) {
    return this.fields[key]
  }

  set(key: string, value: unknown) {
    this.fields[key] = value
  }

  unset(key: string) {
    delete this.fields[key]
  }

  async save() {
    if (failParse) throw new Error('Parse is down')
    this.saves++
  }
}
const queued: Row[] = []
g.useParse = () => ({
  Query: class {
    equalTo() { return this }
    async first() { return queued.find(row => row.get('status') === 'pending') }
  },
  Object: { extend: (name: string) => (name === 'Job' ? class extends Row { constructor() { super(); queued.push(this) } } : { createWithoutData: (id: string) => ({ id }) }) }
})

const { enqueueJob, nextJobAttempt, pickJobs, registerJobHandler, runJob, JOB_BACKOFF_SECONDS } = await import('../server/utils/jobs')

beforeEach(() => {
  failParse = false
  queued.length = 0
  published.length = 0
})

describe('picking jobs', () => {
  const job = (id: string, workspaceId: string) => ({ id, workspaceId })

  test('takes turns across workspaces instead of draining the oldest one first', () => {
    const due = [job('a1', 'A'), job('a2', 'A'), job('a3', 'A'), job('b1', 'B'), job('c1', 'C')]
    expect(pickJobs(due, new Map(), 4).map(j => j.id)).toEqual(['a1', 'b1', 'c1', 'a2'])
  })

  test('never runs more than the per-workspace share, counting what already runs', () => {
    const due = [job('a1', 'A'), job('a2', 'A'), job('a3', 'A'), job('b1', 'B')]
    expect(pickJobs(due, new Map([['A', 1]]), 8, 2).map(j => j.id)).toEqual(['a1', 'b1'])
    expect(pickJobs(due, new Map([['A', 2]]), 8, 2).map(j => j.id)).toEqual(['b1'])
  })

  test('stops at the free slots', () => {
    expect(pickJobs([job('a1', 'A'), job('b1', 'B')], new Map(), 1)).toHaveLength(1)
    expect(pickJobs([job('a1', 'A')], new Map(), 0)).toEqual([])
  })
})

describe('retries', () => {
  test('back off, then give up', () => {
    const now = new Date('2026-10-07T12:00:00Z')
    expect(nextJobAttempt(1, 6, now)!.getTime() - now.getTime()).toBe(JOB_BACKOFF_SECONDS[0]! * 1000)
    expect(nextJobAttempt(5, 6, now)!.getTime() - now.getTime()).toBe(JOB_BACKOFF_SECONDS[4]! * 1000)
    expect(nextJobAttempt(6, 6, now)).toBeNull()
    expect(nextJobAttempt(3, 3, now)).toBeNull()
  })
})

describe('running a job', () => {
  test('a job that works is done', async () => {
    const seen: unknown[] = []
    registerJobHandler('test.ok', async (payload) => { seen.push(payload) })
    const row = new Row({ kind: 'test.ok', payload: { n: 1 }, attempts: 0, status: 'pending' })
    await runJob(row as never)
    expect(seen).toEqual([{ n: 1 }])
    expect(row.fields).toMatchObject({ status: 'done', attempts: 1 })
    expect(row.fields.lockedUntil).toBeUndefined()
  })

  test('a job that fails waits and tries again, then is dead', async () => {
    registerJobHandler('test.fail', async () => { throw new Error('model is down') }, { maxAttempts: 2 })
    const row = new Row({ kind: 'test.fail', payload: {}, attempts: 0, status: 'pending' })
    await runJob(row as never)
    expect(row.fields).toMatchObject({ status: 'pending', attempts: 1, lastError: 'model is down' })
    expect((row.fields.runAt as Date).getTime()).toBeGreaterThan(Date.now())
    await runJob(row as never)
    expect(row.fields).toMatchObject({ status: 'dead', attempts: 2 })
  })

  test('a kind nobody handles is dead, not retried forever', async () => {
    const row = new Row({ kind: 'test.unknown', payload: {}, attempts: 0 })
    await runJob(row as never)
    expect(row.fields).toMatchObject({ status: 'dead', lastError: 'No handler for test.unknown' })
  })
})

describe('queueing', () => {
  test('writes a pending row and wakes the runners', async () => {
    await enqueueJob('test.ok', { n: 2 }, { workspaceId: 'W1' })
    expect(queued).toHaveLength(1)
    expect(queued[0]!.fields).toMatchObject({ kind: 'test.ok', status: 'pending', attempts: 0, payload: { n: 2 }, workspace: { id: 'W1' } })
    expect(JSON.parse(published[0]!)).toEqual({ kind: 'test.ok' })
  })

  test('the same work already waiting is not queued twice', async () => {
    await enqueueJob('test.ok', {}, { workspaceId: 'W1', dedupeKey: 'model:1' })
    await enqueueJob('test.ok', {}, { workspaceId: 'W1', dedupeKey: 'model:1' })
    expect(queued).toHaveLength(1)
  })

  test('with the queue down, the job runs right away instead of being lost', async () => {
    const seen: unknown[] = []
    registerJobHandler('test.inline', async (payload) => { seen.push(payload) })
    failParse = true
    await enqueueJob('test.inline', { n: 3 }, { workspaceId: 'W1' })
    await Bun.sleep(0)
    expect(seen).toEqual([{ n: 3 }])
  })
})
