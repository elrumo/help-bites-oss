import { afterEach, describe, expect, test } from 'bun:test'
import type { H3Event } from 'h3'
import { clientIp } from '../server/utils/rateLimit'

function event(forwardedFor?: string, socket = '10.0.0.9'): H3Event {
  const headers: Record<string, string> = forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }
  return { context: {}, node: { req: { headers, socket: { remoteAddress: socket } } } } as unknown as H3Event
}

afterEach(() => { delete process.env.TRUST_PROXY_HOPS })

describe('clientIp', () => {
  test('one proxy: the address it appended, not what the client sent', () => {
    expect(clientIp(event('1.2.3.4'))).toBe('1.2.3.4')
    expect(clientIp(event('6.6.6.6, 1.2.3.4'))).toBe('1.2.3.4')
    expect(clientIp(event('spoof-a, spoof-b ,1.2.3.4'))).toBe('1.2.3.4')
  })

  test('TRUST_PROXY_HOPS counts proxies from the right', () => {
    process.env.TRUST_PROXY_HOPS = '2'
    expect(clientIp(event('6.6.6.6, 1.2.3.4, 172.64.0.1'))).toBe('1.2.3.4')
    // Fewer entries than hops: the furthest one there is.
    expect(clientIp(event('1.2.3.4'))).toBe('1.2.3.4')
  })

  test('bad TRUST_PROXY_HOPS values fall back to one proxy', () => {
    for (const value of ['0', '-3', 'abc', '']) {
      process.env.TRUST_PROXY_HOPS = value
      expect(clientIp(event('6.6.6.6, 1.2.3.4'))).toBe('1.2.3.4')
    }
  })

  test('no header: the socket address', () => {
    expect(clientIp(event())).toBe('10.0.0.9')
    expect(clientIp(event(' , '))).toBe('10.0.0.9')
  })
})
