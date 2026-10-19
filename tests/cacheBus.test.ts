import { describe, expect, test } from 'bun:test'

const published: string[] = []
;(globalThis as Record<string, unknown>).useRedis = () => ({ publish: async (_channel: string, message: string) => { published.push(message) } })
const { invalidate, onInvalidate, receiveInvalidation } = await import('../server/utils/cacheBus')

describe('cache bus', () => {
  test('an invalidation clears this process and tells the others', async () => {
    const dropped: string[] = []
    onInvalidate('members', key => dropped.push(key))
    await invalidate('members', 'u1')
    expect(dropped).toEqual(['u1'])
    expect(JSON.parse(published.at(-1)!)).toMatchObject({ kind: 'members', key: 'u1' })
  })

  test('a process applies what others publish, but not its own echo', () => {
    const dropped: string[] = []
    onInvalidate('workspace', key => dropped.push(key))
    receiveInvalidation({ kind: 'workspace', key: 'w1', origin: 'someone-else' })
    receiveInvalidation({ ...JSON.parse(published.at(-1)!), kind: 'workspace', key: 'w2' })
    expect(dropped).toEqual(['w1'])
  })
})
