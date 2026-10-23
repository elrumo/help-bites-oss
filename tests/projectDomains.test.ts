import { describe, expect, test } from 'bun:test'
import { domainDnsRecords, homePathFor, normalizeHost, routeForHost } from '../shared/domains'
import { checkDomainRecords, isReservedHost, type Dns } from '../server/utils/projectDomains'

const PK = 'pk_0123456789abcdef01234567'

describe('normalizeHost', () => {
  test('keeps a public hostname, lower-cased and bare', () => {
    expect(normalizeHost('Feedback.LightBites.app')).toBe('feedback.lightbites.app')
    expect(normalizeHost('https://change.lightbites.app/some/path?x=1')).toBe('change.lightbites.app')
    expect(normalizeHost('change.lightbites.app:8443.')).toBe('change.lightbites.app')
    expect(normalizeHost('bücher.example.com')).toBe('xn--bcher-kva.example.com')
  })

  test('refuses what is not a public DNS name', () => {
    for (const bad of ['', 'localhost', 'lightbites', 'a.test', 'x.internal', '10.0.0.1', '*.lightbites.app', 'bad host.com', '-a.example.com', 'a..example.com', 'a.b.c1']) {
      expect(normalizeHost(bad)).toBeNull()
    }
  })
})

describe('domainDnsRecords', () => {
  test('a TXT that proves ownership and a CNAME to the app', () => {
    expect(domainDnsRecords('feedback.lightbites.app', 'tok', 'app.helpbites.app')).toEqual([
      { purpose: 'ownership', type: 'TXT', host: '_helpbites.feedback.lightbites.app', value: 'helpbites-verify=tok', valid: 'unknown' },
      { purpose: 'routing', type: 'CNAME', host: 'feedback.lightbites.app', value: 'app.helpbites.app', valid: 'unknown' }
    ])
  })

  test('an apex host gets an A record when the deployment has an address', () => {
    expect(domainDnsRecords('lightbites.app', 'tok', 'app.helpbites.app', '203.0.113.7')[1]).toMatchObject({ type: 'A', value: '203.0.113.7' })
    expect(domainDnsRecords('lightbites.app', 'tok', 'app.helpbites.app')[1]).toMatchObject({ type: 'CNAME' })
  })
})

describe('routeForHost', () => {
  test('fills in the project key on public pages and keeps the query', () => {
    expect(routeForHost('/changelog', PK)).toEqual({ kind: 'rewrite', path: `/changelog/${PK}` })
    expect(routeForHost('/blog/hello-world?x=1', PK)).toEqual({ kind: 'rewrite', path: `/blog/${PK}/hello-world?x=1` })
    expect(routeForHost('/pricing/pro', PK)).toEqual({ kind: 'rewrite', path: `/pricing/${PK}/pro` })
    expect(routeForHost('/legal/privacy/', PK)).toEqual({ kind: 'rewrite', path: `/legal/${PK}/privacy` })
  })

  test('"/" goes to the target page', () => {
    expect(routeForHost('/', PK)).toEqual({ kind: 'rewrite', path: '/_domain' })
  })

  test('a path that already names this project passes; another project is a 404', () => {
    expect(routeForHost(`/hub/${PK}`, PK)).toEqual({ kind: 'pass' })
    expect(routeForHost('/hub/pk_ffffffffffffffffffffffff', PK)).toEqual({ kind: 'notFound' })
  })

  test('the API and assets pass; the panel and admin API do not exist here', () => {
    for (const path of ['/v1/feedback?pk=x', '/widget.js', '/feedback.js', '/_nuxt/entry.js', '/embed/feedback?pk=x', '/_domain']) expect(routeForHost(path, PK)).toEqual({ kind: 'pass' })
    for (const path of ['/inbox', '/login', '/projects/abc', '/v1/admin/projects', '/v1/internal/domain-check', '/mcp', '/docs']) expect(routeForHost(path, PK)).toEqual({ kind: 'notFound' })
  })
})

test('homePathFor sends each target to its page', () => {
  expect(homePathFor('hub', PK)).toBe(`/hub/${PK}`)
  expect(homePathFor('feedback', PK)).toBe(`/embed/feedback?pk=${PK}`)
  expect(homePathFor('changelog', PK)).toBe(`/changelog/${PK}`)
})

describe('checkDomainRecords', () => {
  const dns = (records: { txt?: string[], cname?: string[], a?: Record<string, string[]> }): Dns => ({
    txt: async () => records.txt || [],
    cname: async () => records.cname || [],
    a: async name => records.a?.[name] || []
  })

  test('both records right', async () => {
    process.env.APP_URL = 'https://app.helpbites.app'
    expect(await checkDomainRecords('f.lightbites.app', 'tok', dns({ txt: ['helpbites-verify=tok'], cname: ['app.helpbites.app.'] }))).toEqual({ ownership: true, routing: true })
  })

  test('the TXT must carry this domain\'s token; an A record that matches the app\'s also routes', async () => {
    process.env.APP_URL = 'https://app.helpbites.app'
    const result = await checkDomainRecords('f.lightbites.app', 'tok', dns({ txt: ['helpbites-verify=other'], a: { 'f.lightbites.app': ['203.0.113.7'], 'app.helpbites.app': ['203.0.113.7'] } }))
    expect(result).toEqual({ ownership: false, routing: true })
  })

  test('nothing in DNS yet', async () => {
    expect(await checkDomainRecords('f.lightbites.app', 'tok', dns({}))).toEqual({ ownership: false, routing: false })
  })
})

test('the deployment\'s own hosts are reserved', () => {
  process.env.APP_URL = 'https://app.helpbites.app'
  process.env.CUSTOM_DOMAIN_RESERVED = 'helpbites.dev'
  expect(isReservedHost('app.helpbites.app')).toBe(true)
  expect(isReservedHost('x.helpbites.dev')).toBe(true)
  expect(isReservedHost('feedback.lightbites.app')).toBe(false)
  delete process.env.CUSTOM_DOMAIN_RESERVED
})
