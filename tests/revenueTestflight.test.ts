import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { testflightReport, usageCounts } from '../server/utils/revenue/testflight'

const point = (installCount: number, sessionCount: number, crashCount = 0, inviteCount = 0, feedbackCount = 0) => ({ start: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z', values: { installCount, sessionCount, crashCount, inviteCount, feedbackCount } })

describe('usage counts', () => {
  test('a build is the sum of its daily data points, across every series', () => {
    expect(usageCounts({ data: [{ dataPoints: [point(2, 10, 1, 3, 1), point(1, 4)] }, { dataPoints: [point(0, 1)] }] })).toEqual({ installs: 3, sessions: 15, crashes: 1, invites: 3, feedback: 1 })
  })
  test('no metrics (a 404) and missing values are zeros', () => {
    const zero = { installs: 0, sessions: 0, crashes: 0, invites: 0, feedback: 0 }
    expect(usageCounts(null)).toEqual(zero)
    expect(usageCounts({ data: [{ dataPoints: [{ values: {} }, {}] }, {}] })).toEqual(zero)
  })
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

let credentials: Record<string, string>
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  credentials = { issuerId: '69a6de70-03db-47e3-e053-5b8c7c11a4d1', keyId: 'ABC123DEFG', vendorNumber: '12345678', privateKey: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` }
})

function fakeApple(status = 200): string[] {
  const paths: string[] = []
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input))
    paths.push(url.pathname)
    if (status !== 200) return Response.json({ errors: [{ detail: 'Forbidden' }] }, { status })
    if (url.pathname === '/v1/apps') return Response.json({ data: [{ id: 'a1', attributes: { name: 'App One', bundleId: 'com.one' } }, { id: 'a2', attributes: { name: 'App Two', bundleId: 'com.two' } }] })
    if (url.pathname === '/v1/builds') {
      return url.searchParams.get('filter[app]') === 'a1'
        ? Response.json({
            data: [{ id: 'b2', attributes: { version: '12', uploadedDate: '2026-10-22T10:00:00Z', expired: false }, relationships: { preReleaseVersion: { data: { id: 'p1' } } } }, { id: 'b1', attributes: { version: '11', uploadedDate: '2026-10-01T10:00:00Z', expired: true }, relationships: { preReleaseVersion: { data: { id: 'p1' } } } }],
            included: [{ id: 'p1', attributes: { version: '1.4' } }]
          })
        : Response.json({ data: [] })
    }
    const build = url.pathname.split('/')[3]
    if (build === 'b1') return Response.json({ errors: [] }, { status: 404 })
    return Response.json({ data: [{ dataPoints: [point(5, 20, 1, 6, 2), point(3, 8)] }] })
  }) as unknown as typeof fetch
  return paths
}

describe('the TestFlight report', () => {
  test('apps, their newest builds with version and number, and usage per build, app and in total', async () => {
    const paths = fakeApple()
    const report = await testflightReport(credentials)
    expect(report.apps.map(a => [a.name, a.bundleId, a.builds.length])).toEqual([['App One', 'com.one', 2], ['App Two', 'com.two', 0]])
    expect(report.apps[0]!.builds[0]).toEqual({ id: 'b2', version: '1.4', build: '12', uploadedAt: '2026-10-22T10:00:00Z', expired: false, installs: 8, sessions: 28, crashes: 1, invites: 6, feedback: 2 })
    // A build Apple has no metrics for is listed with zeros.
    expect(report.apps[0]!.builds[1]).toMatchObject({ id: 'b1', expired: true, installs: 0 })
    expect(report.totals).toEqual({ installs: 8, sessions: 28, crashes: 1, invites: 6, feedback: 2 })
    expect(report.apps[1]!.totals.installs).toBe(0)
    expect(paths).toEqual(['/v1/apps', '/v1/builds', '/v1/builds', '/v1/builds/b2/metrics/betaBuildUsages', '/v1/builds/b1/metrics/betaBuildUsages'])
  })

  test('a key that cannot see apps is a 502 that says what role it needs', async () => {
    fakeApple(403)
    await expect(testflightReport(credentials)).rejects.toMatchObject({ statusCode: 502, statusMessage: expect.stringContaining('Developer or App Manager') })
  })
})
