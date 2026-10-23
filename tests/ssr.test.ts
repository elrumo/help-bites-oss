import { describe, expect, test } from 'bun:test'
import { createHelpBites, renderChangelog, renderRoadmap, skeleton } from '../public/ssr.mjs'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch that answers after `delay` ms and counts its calls. */
function fake(answer: () => Response, delay = 0) {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    await sleep(delay)
    return answer()
  }
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const make = (f: ReturnType<typeof fake>, over: Record<string, unknown> = {}) => createHelpBites({ host: 'https://hb.test/', pk: 'pk_x', fetch: f.fetch, ...over })

describe('createHelpBites reads', () => {
  test('an answer inside the budget is live, then served from the cache without a request', async () => {
    const f = fake(() => json({ items: [] }))
    const hb = make(f)
    expect(await hb.roadmap()).toEqual({ data: { items: [] }, source: 'live' })
    expect((await hb.roadmap()).source).toBe('cache')
    expect(f.calls).toEqual(['https://hb.test/v1/feedback/roadmap?pk=pk_x'])
  })

  test('an answer past the budget is late, and the request still fills the cache for the next visit', async () => {
    const f = fake(() => json({ ok: 1 }), 60)
    const hb = make(f, { budget: 10 })
    expect(await hb.get('/v1/x')).toEqual({ data: null, source: 'late' })
    await sleep(100)
    expect(await hb.get('/v1/x')).toEqual({ data: { ok: 1 }, source: 'cache' })
    expect(f.calls).toHaveLength(1)
  })

  test('past its ttl an answer is served stale at once and refreshed behind the caller', async () => {
    let n = 0
    const f = fake(() => json({ n: ++n }))
    const hb = make(f, { ttl: 50 })
    expect((await hb.get('/v1/x')).data).toEqual({ n: 1 })
    await sleep(70)
    expect(await hb.get('/v1/x')).toEqual({ data: { n: 1 }, source: 'stale' })
    await sleep(20)
    expect(await hb.get('/v1/x')).toEqual({ data: { n: 2 }, source: 'cache' })
  })

  test('concurrent reads share one request', async () => {
    const f = fake(() => json({}), 20)
    const hb = make(f)
    await Promise.all([hb.get('/v1/x'), hb.get('/v1/x'), hb.get('/v1/x')])
    expect(f.calls).toHaveLength(1)
  })

  test('failures never throw: an error status or a network error is source error', async () => {
    const down = make(fake(() => json({}, 404)))
    expect(await down.get('/v1/x')).toEqual({ data: null, source: 'error', status: 404 })
    const broken = createHelpBites({ host: 'https://hb.test', pk: 'pk_x', fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch })
    expect(await broken.get('/v1/x')).toEqual({ data: null, source: 'error', status: 0 })
  })

  test('a failed refresh keeps serving the stale answer', async () => {
    let fail = false
    const f = fake(() => (fail ? json({}, 500) : json({ v: 1 })))
    const hb = make(f, { ttl: 10 })
    await hb.get('/v1/x')
    fail = true
    await sleep(30)
    expect((await hb.get('/v1/x')).data).toEqual({ v: 1 })
    await sleep(10)
    expect((await hb.get('/v1/x')).data).toEqual({ v: 1 })
  })

  test('after a failure the address is not asked again until the backoff has passed', async () => {
    let status = 500
    const f = fake(() => json({ ok: 1 }, status))
    const hb = make(f, { backoff: 50 })
    expect((await hb.get('/v1/x')).source).toBe('error')
    expect((await hb.get('/v1/x')).source).toBe('error')
    expect(f.calls).toHaveLength(1)
    status = 200
    await sleep(60)
    expect((await hb.get('/v1/x')).data).toEqual({ ok: 1 })
    expect(f.calls).toHaveLength(2)
  })

  test('a broken store is a miss, not an error', async () => {
    const store = { get: () => { throw new Error('redis down') }, set: () => { throw new Error('redis down') } }
    expect((await make(fake(() => json({ a: 1 })), { store }).get('/v1/x')).data).toEqual({ a: 1 })
  })

  test('legal unwraps the document; script keeps a file and refuses odd names', async () => {
    const f = fake(() => json({ document: { title: 'Privacy', html: '<p>x</p>' } }))
    expect((await make(f).legal('privacy')).data).toEqual({ title: 'Privacy', html: '<p>x</p>' })
    expect(f.calls[0]).toBe('https://hb.test/v1/legal/pk_x/privacy')

    const s = fake(() => new Response('console.log(1)'))
    const hb = make(s)
    expect((await hb.script('widget.js')).body).toBe('console.log(1)')
    expect((await hb.script('widget.js')).source).toBe('cache')
    expect((await hb.script('../etc/passwd')).body).toBeNull()
    expect(s.calls).toHaveLength(1)
  })
})

describe('embed', () => {
  const changelog = { releases: [{ version: '1.0', title: 'First', publishedAt: '2026-01-02T00:00:00Z', summary: '', entries: [{ title: 'Hello <b>', tag: 'new', publishedAt: '2026-01-02T00:00:00Z', bodyHtml: '<p>Body</p>' }] }], entries: [{ title: 'Later', tag: 'fix', publishedAt: '2026-02-01T00:00:00Z', summary: 'S', bodyHtml: '<p>Fixed</p>' }] }

  test('a snapshot inside the budget: content, the style, and a script tag aimed at the container', async () => {
    const r = await make(fake(() => json(changelog))).embed('changelog', { scriptSrc: '/hb/changelog.js' })
    expect(r.ssr).toBe('ready')
    expect(r.css).toContain('.hb-ssr')
    expect(r.html).toContain('data-hb-ssr="ready"')
    expect(r.html).toContain('<p>Body</p>')
    expect(r.html).toContain('Hello &lt;b&gt;')
    // Newest first: the February entry comes before the January release.
    expect(r.html.indexOf('Later')).toBeLessThan(r.html.indexOf('First'))
    expect(r.html).toContain('<script src="/hb/changelog.js" data-project="pk_x" data-host="https://hb.test" data-target="#hb-changelog" defer>')
  })

  test('past the budget it is a skeleton the script replaces', async () => {
    const r = await make(fake(() => json(changelog), 80), { budget: 5 }).embed('changelog')
    expect(r.ssr).toBe('pending')
    expect(r.source).toBe('late')
    expect(r.inner).toContain('aria-busy="true"')
    expect(r.html).toContain('src="https://hb.test/changelog.js"')
  })

  test('the board and the chat are frames: a skeleton with no request; the roadmap view is feedback.js', async () => {
    const f = fake(() => json({}))
    const hb = make(f)
    expect((await hb.embed('feedback')).inner).toBe(skeleton('feedback'))
    const chat = await hb.embed('chat', { id: 'support' })
    expect(chat.html).toContain('id="support"')
    expect(chat.html).toContain('data-mode="inline"')
    expect(chat.html).toContain('widget.js')
    expect(f.calls).toHaveLength(0)
    const roadmap = await make(fake(() => json({ statuses: [], items: [] }))).embed('roadmap')
    expect(roadmap.html).toContain('feedback.js')
    expect(roadmap.html).toContain('data-only="roadmap"')
  })

  test('attributes are escaped', async () => {
    const r = await make(fake(() => json({}))).embed('feedback', { attrs: { label: '"><script>x</script>' } })
    expect(r.html).not.toContain('<script>x')
  })

  test('an unknown kind is refused', async () => {
    await expect(make(fake(() => json({}))).embed('blog')).rejects.toThrow()
  })
})

describe('renderers', () => {
  test('the roadmap lists a status only when it has items, in the board order, and escapes text', () => {
    const html = renderRoadmap({
      statuses: [{ key: 'now', label: 'Now' }, { key: 'next', label: 'Next' }, { key: 'done', label: 'Done' }],
      items: [{ title: 'B<i>', description: 'd', status: 'next', voteCount: 3 }, { title: 'A', status: 'now' }]
    })
    expect(html.indexOf('Now')).toBeLessThan(html.indexOf('Next'))
    expect(html).not.toContain('Done')
    expect(html).toContain('B&lt;i&gt;')
    expect(html).toContain('3 votes')
  })

  test('an empty changelog renders an empty snapshot, not a crash', () => {
    expect(renderChangelog({})).toContain('data-hb-ssr="ready"')
  })
})
