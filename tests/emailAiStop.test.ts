import { afterAll, describe, expect, test } from 'bun:test'

// Stopping an AI designer turn that runs on another app server
// (server/utils/emailAiRuns.ts), against an in-memory Redis.

const g = globalThis as Record<string, unknown>
const store = new Map<string, string>()
const sets: { key: string, args: unknown[] }[] = []
let onSet = (_key: string) => {}
g.__sbRedis = {
  async set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && store.has(key)) return null
    store.set(key, value)
    sets.push({ key, args })
    onSet(key)
    return 'OK'
  },
  async get(key: string) { return store.get(key) ?? null },
  async del(key: string) { return store.delete(key) ? 1 : 0 },
  async mget(...keys: string[]) { return keys.map(key => store.get(key) ?? null) }
}

const { emailAiRun, startEmailAiRun, stopEmailAiRun } = await import('../server/utils/emailAiRuns')
// The next test file gets no Redis, as it would have.
afterAll(() => { delete g.__sbRedis })

async function within(ms: number, check: () => boolean): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return true
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return check()
}

describe('stopping a turn on another server', () => {
  test('the server running the turn sees the Stop flag within about a second', async () => {
    const run = (await startEmailAiRun('T1', 'chat', 'q1', 'm1'))!
    expect(run.signal.aborted).toBe(false)
    store.set(`sb:emailai:abort:${run.streamId}`, '1')
    expect(await within(2500, () => run.signal.aborted)).toBe(true)
  })

  test('Stop leaves the flag when the turn is not running here, and waits for it to wrap up', async () => {
    store.set('sb:emailai:run:T2', JSON.stringify({ chatId: 'chat', streamId: 'elsewhere', messageId: 'm' }))
    // The other server stops and frees the template.
    onSet = (key) => { if (key === 'sb:emailai:abort:elsewhere') setTimeout(() => store.delete('sb:emailai:run:T2'), 150) }
    await stopEmailAiRun('T2', 'chat')
    onSet = () => {}
    expect(store.get('sb:emailai:abort:elsewhere')).toBe('1')
    expect(sets.find(s => s.key === 'sb:emailai:abort:elsewhere')!.args).toEqual(['EX', 60])
    expect(await emailAiRun('T2')).toBeNull()
  })

  test('another chat\'s turn is left alone', async () => {
    store.set('sb:emailai:run:T3', JSON.stringify({ chatId: 'theirs', streamId: 'other-chat', messageId: 'm' }))
    await stopEmailAiRun('T3', 'mine')
    expect(store.has('sb:emailai:abort:other-chat')).toBe(false)
  })

  test('once the turn has ended, nothing is watching for it any more', async () => {
    const run = (await startEmailAiRun('T4', 'chat', 'q4', 'm4'))!
    store.delete('sb:emailai:run:T4')
    await new Promise(resolve => setTimeout(resolve, 1200))
    store.set(`sb:emailai:abort:${run.streamId}`, '1')
    expect(await within(1500, () => run.signal.aborted)).toBe(false)
  })
})
