import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { pinnedFetch, safeFetch, setResolver } from '../server/utils/outbound'
import { pinnedPostgres, postgresDriver } from '../server/utils/sources/postgres'

// A server on 127.0.0.1 that records what reached it. TEST-NET-3 (203.0.113.0/24)
// stands in for a public address: it classifies as public and nothing answers there.
const PUBLIC = '203.0.113.7'
const hits: { host: string | null, method: string, path: string, body: string }[] = []
const local = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    hits.push({ host: req.headers.get('host'), method: req.method, path: url.pathname + url.search, body: await req.text() })
    if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/elsewhere' } })
    if (url.pathname === '/slow') return Bun.sleep(1000).then(() => new Response('late'))
    if (url.pathname === '/stream') {
      let i = 0
      return new Response(new ReadableStream({
        async pull(controller) {
          if (i) await Bun.sleep(50)
          if (i === 20) return controller.close()
          controller.enqueue(new TextEncoder().encode(`chunk ${i++}\n`))
        }
      }))
    }
    return new Response('ok')
  }
})

const lookups: string[] = []
/** A resolver that answers `first` once, then `later` to every lookup after it. */
const rebinding = (first: string[], later: string[] = ['127.0.0.1']) => async (hostname: string) => {
  lookups.push(hostname)
  return lookups.length === 1 ? first : later
}

const env = { ...process.env }
beforeEach(() => {
  hits.length = 0
  lookups.length = 0
})
afterEach(() => {
  setResolver()
  process.env = { ...env }
})
afterAll(() => local.stop(true))

describe('pinned outbound requests', () => {
  test('a name that answers a public address to the check and localhost afterwards never reaches localhost', async () => {
    // localhost: what fetch() itself would resolve the name to, were it to resolve it again.
    process.env.ALLOW_PRIVATE_NETWORK = '1'
    setResolver(rebinding([PUBLIC]))
    const outcome = await safeFetch(`http://localhost:${local.port}/secret`, { timeoutMs: 500 }).then(r => r.status, () => 'refused')
    expect(hits).toEqual([])
    expect(lookups).toEqual(['localhost'])
    expect(outcome).not.toBe(200)
  })

  test('it connects to the address that was checked, with the name as the Host header', async () => {
    process.env.ALLOW_PRIVATE_NETWORK = '1'
    setResolver(rebinding(['127.0.0.1'], [PUBLIC]))
    // hooks.pinned.test is in no DNS: reaching the server at all means the checked address was used.
    const res = await safeFetch(`http://hooks.pinned.test:${local.port}/hook?x=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
    expect(await res.text()).toBe('ok')
    expect(hits).toEqual([{ host: `hooks.pinned.test:${local.port}`, method: 'POST', path: '/hook?x=1', body: '{"a":1}' }])
    expect(lookups).toEqual(['hooks.pinned.test'])
  })

  test('the address rules are unchanged: private needs ALLOW_PRIVATE_NETWORK, metadata never', async () => {
    const status = (p: Promise<unknown>) => p.then(() => 0, (e: { statusCode?: number }) => e.statusCode)
    setResolver(async () => ['127.0.0.1'])
    expect(await status(safeFetch(`http://db.pinned.test:${local.port}/`))).toBe(400)
    setResolver(async () => [PUBLIC, '10.0.0.8'])
    expect(await status(safeFetch(`http://db.pinned.test:${local.port}/`))).toBe(400)
    process.env.ALLOW_PRIVATE_NETWORK = '1'
    setResolver(async () => ['169.254.169.254'])
    expect(await status(safeFetch('http://metadata.pinned.test/latest/'))).toBe(400)
    setResolver(async () => [])
    expect(await status(safeFetch('http://nowhere.pinned.test/'))).toBe(400)
    expect(hits).toEqual([])
  })

  test('responses stream, and the caller\'s abort signal still stops them', async () => {
    process.env.ALLOW_PRIVATE_NETWORK = '1'
    setResolver(async () => ['127.0.0.1'])
    const controller = new AbortController()
    const res = await safeFetch(`http://ai.pinned.test:${local.port}/stream`, { signal: controller.signal, timeoutMs: 10 * 60 * 1000 })
    const reader = res.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('chunk 0\n')
    controller.abort(new Error('stopped'))
    await expect(reader.read()).rejects.toThrow('stopped')
  })

  test('redirects are not followed, and the timeout still applies', async () => {
    process.env.ALLOW_PRIVATE_NETWORK = '1'
    setResolver(async () => ['127.0.0.1'])
    expect((await pinnedFetch(`http://app.pinned.test:${local.port}/redirect`)).status).toBe(302)
    await expect(safeFetch(`http://app.pinned.test:${local.port}/redirect`)).rejects.toMatchObject({ statusCode: 502 })
    await expect(safeFetch(`http://app.pinned.test:${local.port}/slow`, { timeoutMs: 100 })).rejects.toThrow()
  })

  test('https goes to the IP with the name as Host and as the TLS server name', async () => {
    const real = globalThis.fetch
    const calls: { url: string, init: RequestInit & { tls?: { serverName?: string } } }[] = []
    globalThis.fetch = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('ok')
    }) as unknown as typeof fetch
    try {
      setResolver(async () => ['2606:4700::1111', '93.184.215.14'])
      await safeFetch('https://api.example.com/v1/chat/completions?x=1', { headers: { authorization: 'Bearer k' } })
      setResolver(async () => ['2606:4700::1111'])
      await safeFetch('https://v6.example.com:8443/')
      await safeFetch('https://93.184.215.14/')
    } finally {
      globalThis.fetch = real
    }
    const [v4, v6, literal] = calls
    expect(v4!.url).toBe('https://93.184.215.14/v1/chat/completions?x=1')
    expect(new Headers(v4!.init.headers).get('host')).toBe('api.example.com')
    expect(new Headers(v4!.init.headers).get('authorization')).toBe('Bearer k')
    expect(v4!.init.tls).toEqual({ serverName: 'api.example.com' })
    expect(v4!.init.redirect).toBe('manual')
    expect(v6!.url).toBe('https://[2606:4700::1111]:8443/')
    expect(new Headers(v6!.init.headers).get('host')).toBe('v6.example.com:8443')
    expect(v6!.init.tls).toEqual({ serverName: 'v6.example.com' })
    // An IP typed in is already the checked address.
    expect(literal!.url).toBe('https://93.184.215.14/')
    expect(literal!.init.tls).toBeUndefined()
  })
})

describe('pinned Postgres connections', () => {
  test('the connection string points at the checked address; TLS keeps the host name', async () => {
    const pinned = await pinnedPostgres('postgres://u:p%40ss@db.example.com:6543/postgres?sslmode=require', '10.0.0.5')
    expect(pinned).toEqual({ url: 'postgres://u:p%40ss@10.0.0.5:6543/postgres?sslmode=require', tls: { serverName: 'db.example.com' } })
    expect((await pinnedPostgres('postgresql://u:p@db.example.com/app?sslmode=verify-full', '2001:db8::1')).url).toBe('postgresql://u:p@[2001:db8::1]/app?sslmode=verify-full')
    expect((await pinnedPostgres('postgresql://u:p@db.example.com/app?sslmode=verify-full', '2001:db8::1')).tls).toEqual({ serverName: 'db.example.com' })
    expect(await pinnedPostgres('postgres://u:p@db.example.com/app', '10.0.0.5')).toEqual({ url: 'postgres://u:p@10.0.0.5/app' })
  })

  test('the driver connects to the checked address, never resolving the name itself', async () => {
    // A Postgres front door that refuses every login, naming the user and database it was asked for.
    const startups: string[] = []
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        data(socket, data) {
          const fields = data.subarray(8).toString().split('\0')
          startups.push(`${fields[fields.indexOf('user') + 1]}@${fields[fields.indexOf('database') + 1]}`)
          const body = Buffer.from('SFATAL\0C28000\0Mpinned front door\0\0')
          const head = Buffer.alloc(5)
          head.write('E')
          head.writeInt32BE(body.length + 4, 1)
          socket.end(Buffer.concat([head, body]))
        }
      }
    })
    try {
      process.env.ALLOW_PRIVATE_NETWORK = '1'
      setResolver(rebinding(['127.0.0.1'], [PUBLIC]))
      const secret = postgresDriver.readSecret({ url: `postgres://alice:pw@db.pinned.test:${server.port}/shop` })
      const failure = await postgresDriver.test({ table: 'users', idField: 'id', mapping: {} } as never, secret).then(() => null, e => e)
      expect(failure).toMatchObject({ statusCode: 502 })
      expect(failure.statusMessage).toContain('pinned front door')
      expect(startups).toEqual(['alice@shop'])
      expect(lookups).toEqual(['db.pinned.test'])
    } finally {
      server.stop(true)
    }
  })
})
