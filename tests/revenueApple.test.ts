import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { addDays, appleAdapter, appleToken, lastReportDay, p8Body, salesRows } from '../server/utils/revenue/apple'

// Apple's Summary Sales report columns (App Store Connect Help > Summary Sales Report).
const COLUMNS = ['Provider', 'Provider Country', 'SKU', 'Developer', 'Title', 'Version', 'Product Type Identifier', 'Units', 'Developer Proceeds', 'Begin Date', 'End Date', 'Customer Currency', 'Country Code', 'Currency of Proceeds', 'Apple Identifier', 'Customer Price', 'Promo Code', 'Parent Identifier', 'Subscription', 'Period', 'Category', 'CMB', 'Device', 'Supported Platforms', 'Proceeds Reason', 'Preserved Pricing', 'Client', 'Order Type']

const line = (v: Record<string, string>) => COLUMNS.map(c => v[c] ?? '').join('\t')
const report = (...lines: Record<string, string>[]) => [COLUMNS.join('\t'), ...lines.map(line)].join('\n') + '\n'
const sale = (v: Record<string, string>) => ({ Provider: 'APPLE', 'Provider Country': 'US', Developer: 'Ada', 'Begin Date': '10/21/2026', 'End Date': '10/21/2026', ...v })

const DAY = '2026-10-21'
const fixture = report(
  // A free app and its update: units, no proceeds.
  sale({ SKU: 'appone', Title: 'App One', 'Product Type Identifier': '1F', Units: '400', 'Developer Proceeds': '0', 'Customer Currency': 'USD', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Customer Price': '0' }),
  sale({ SKU: 'appone', Title: 'App One', 'Product Type Identifier': '7F', Units: '900', 'Developer Proceeds': '0', 'Currency of Proceeds': 'USD', 'Customer Price': '0' }),
  // A subscription: new and renewals in the US, a refunded renewal (negative units, positive proceeds), and some in the UK.
  sale({ SKU: 'pro.monthly', Title: 'pro.monthly', 'Parent Identifier': 'appone', 'Product Type Identifier': 'IAY', Units: '3', 'Developer Proceeds': '0.70', 'Customer Currency': 'USD', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Customer Price': '0.99', Subscription: 'New', Period: '1 Month' }),
  sale({ SKU: 'pro.monthly', Title: 'pro.monthly', 'Parent Identifier': 'appone', 'Product Type Identifier': 'IAY', Units: '10', 'Developer Proceeds': '4.20', 'Customer Currency': 'USD', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Customer Price': '5.99', Subscription: 'Renewal', Period: '1 Month' }),
  sale({ SKU: 'pro.monthly', Title: 'pro.monthly', 'Parent Identifier': 'appone', 'Product Type Identifier': 'IAY', Units: '-1', 'Developer Proceeds': '4.20', 'Customer Currency': 'USD', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Customer Price': '-5.99', Subscription: 'Renewal', Period: '1 Month' }),
  sale({ SKU: 'pro.monthly', Title: 'pro.monthly', 'Parent Identifier': 'appone', 'Product Type Identifier': 'IAY', Units: '5', 'Developer Proceeds': '3.50', 'Customer Currency': 'GBP', 'Country Code': 'GB', 'Currency of Proceeds': 'GBP', 'Customer Price': '4.99', Subscription: 'Renewal', Period: '1 Month' }),
  // Customers in two countries paying in other currencies, settled in the one developer is paid in.
  sale({ SKU: 'pro.monthly', Title: 'pro.monthly', 'Product Type Identifier': 'IAY', Units: '2', 'Developer Proceeds': '3.60', 'Customer Currency': 'EUR', 'Country Code': 'DE', 'Currency of Proceeds': 'GBP', 'Customer Price': '5.49', Subscription: 'Renewal' }),
  // A zero-decimal currency.
  sale({ SKU: 'pro.lifetime', Title: 'Pro lifetime', 'Product Type Identifier': 'IA1', Units: '2', 'Developer Proceeds': '480', 'Customer Currency': 'JPY', 'Country Code': 'JP', 'Currency of Proceeds': 'JPY', 'Customer Price': '680' }),
  // A sale and its refund on the same day cancel out.
  sale({ SKU: 'tip', Title: 'Tip', 'Product Type Identifier': 'IA1', Units: '1', 'Developer Proceeds': '1.00', 'Currency of Proceeds': 'USD', 'Customer Price': '1.99' }),
  sale({ SKU: 'tip', Title: 'Tip', 'Product Type Identifier': 'IA1', Units: '-1', 'Developer Proceeds': '1.00', 'Currency of Proceeds': 'USD', 'Customer Price': '-1.99' })
)

describe('the sales report as payment rows', () => {
  test('one row per SKU and currency of proceeds, in the smallest unit, with refunds netted', () => {
    const rows = salesRows(fixture, DAY)
    expect(rows.map(r => [r.stripeId, r.currency, r.amount])).toEqual([
      // 3 * 0.70 + 10 * 4.20 - 1 * 4.20
      [`apple:${DAY}:pro.monthly:usd`, 'usd', 3990],
      // 5 * 3.50 + 2 * 3.60
      [`apple:${DAY}:pro.monthly:gbp`, 'gbp', 2470],
      // yen has no cents
      [`apple:${DAY}:pro.lifetime:jpy`, 'jpy', 960]
    ])
  })

  test('free apps, updates and cancelled sales add nothing', () => {
    const skus = salesRows(fixture, DAY).map(r => r.stripeId)
    expect(skus.some(id => id.includes('appone') || id.includes(':tip:'))).toBe(false)
  })

  test('a row is a succeeded payment of that day, with no customer', () => {
    const [usd] = salesRows(fixture, DAY)
    expect(usd).toMatchObject({
      source: 'apple', status: 'succeeded', customerId: '', email: '', refunded: 0, net: 3990,
      paidAtSec: Date.parse('2026-10-21T00:00:00Z') / 1000, month: '2026-10',
      description: 'pro.monthly (subscription new + renewal)'
    })
    expect(salesRows(fixture, DAY)[2]!.description).toBe('Pro lifetime')
  })

  test('a day of refunds alone is a negative row that reduces the revenue', () => {
    const rows = salesRows(report(sale({ SKU: 'appone', Title: 'App One', 'Product Type Identifier': '1F', Units: '-50', 'Developer Proceeds': '0.70', 'Currency of Proceeds': 'USD', 'Customer Price': '-0.99' })), DAY)
    expect(rows.map(r => [r.amount, r.net])).toEqual([[-3500, -3500]])
  })

  test('the docs spell the column "Developer Proceeds (per unit)"; either works', () => {
    const tsv = report(sale({ SKU: 'a', Units: '2', 'Developer Proceeds': '0.70', 'Currency of Proceeds': 'USD' })).replace('Developer Proceeds', 'Developer Proceeds (per unit)')
    expect(salesRows(tsv, DAY)[0]!.amount).toBe(140)
  })

  test('an empty report has no rows; a report of another shape is an error, not silence', () => {
    expect(salesRows(COLUMNS.join('\t'), DAY)).toEqual([])
    expect(salesRows('', DAY)).toEqual([])
    expect(() => salesRows('SKU\tUnits\nx\t1\n', DAY)).toThrow(/Developer Proceeds/)
  })
})

describe('days', () => {
  test('addDays crosses months and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  test('the newest report day is yesterday in Pacific time', () => {
    // 02:00 UTC on the 24th is still the evening of the 23rd in Los Angeles (PDT, UTC-7).
    expect(lastReportDay(new Date('2026-10-24T02:00:00Z'))).toBe('2026-10-22')
    expect(lastReportDay(new Date('2026-10-24T15:00:00Z'))).toBe('2026-10-23')
    // Winter: PST, UTC-8.
    expect(lastReportDay(new Date('2026-01-15T07:30:00Z'))).toBe('2026-01-13')
  })
})

const pem = (der: ArrayBuffer) => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
let pair: CryptoKeyPair
let p8: string

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  p8 = pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
})

describe('the private key as pasted', () => {
  test('line breaks, "\\n" text, CRLF, quotes and a missing header all read the same', () => {
    const body = p8Body(p8)
    expect(body).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(p8Body(p8.trim().replaceAll('\n', '\\n'))).toBe(body)
    expect(p8Body(p8.replaceAll('\n', '\r\n'))).toBe(body)
    expect(p8Body(p8.replaceAll('\n', ' '))).toBe(body)
    expect(p8Body(`"${p8.replaceAll('\n', '')}"`)).toBe(body)
    expect(p8Body(`  ${body}  `)).toBe(body)
  })

  test('something that is not a PKCS#8 key is a 400', () => {
    for (const bad of ['', 'hello', '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI\n-----END EC PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----']) {
      expect(() => p8Body(bad)).toThrow(expect.objectContaining({ statusCode: 400 }))
    }
  })
})

const issuerId = '69a6de70-03db-47e3-e053-5b8c7c11a4d1'
const keyId = 'ABC123DEFG'
const parts = (token: string) => token.split('.') as [string, string, string]
const json = (b64: string) => JSON.parse(Buffer.from(b64, 'base64url').toString())

describe('the App Store Connect token', () => {
  test('is an ES256 JWT with the claims Apple asks for, and its signature verifies', async () => {
    const token = await appleToken({ issuerId, keyId, privateKey: p8 }, 1_800_000_000)
    const [header, payload, signature] = parts(token)
    expect(json(header)).toEqual({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    const claims = json(payload)
    expect(claims).toEqual({ iss: issuerId, iat: 1_800_000_000, exp: 1_800_000_000 + 15 * 60, aud: 'appstoreconnect-v1' })
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(20 * 60)
    const raw = Buffer.from(signature, 'base64url')
    expect(raw.length).toBe(64)
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, raw, Buffer.from(`${header}.${payload}`))).toBe(true)
    // Not the signature of anything else.
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, raw, Buffer.from(`${header}.${payload}x`))).toBe(false)
  })

  test('a key pasted with "\\n" for line breaks signs the same way', async () => {
    const token = await appleToken({ issuerId, keyId, privateKey: p8.trim().replaceAll('\n', '\\n') })
    const [header, payload, signature] = parts(token)
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(signature, 'base64url'), Buffer.from(`${header}.${payload}`))).toBe(true)
  })

  test('well-shaped base64 that is not a key is a 400', async () => {
    await expect(appleToken({ issuerId, keyId, privateKey: 'A'.repeat(120) })).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ---- the adapter, against a fake Apple ------------------------------------------------

type Call = { day: string, url: URL, auth: string }
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** Answers each report date from `days` (a TSV), 404 for the rest; `status` answers every request with it instead. */
function fakeApple(days: Record<string, string> = {}, status = 200): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ day: url.searchParams.get('filter[reportDate]') || '', url, auth: new Headers(init?.headers).get('authorization') || '' })
    if (status !== 200) return Response.json({ errors: [{ code: 'NOT_AUTHORIZED', detail: 'Provide a properly configured and signed bearer token.' }] }, { status })
    const tsv = days[calls.at(-1)!.day]
    return tsv ? new Response(gzipSync(tsv), { headers: { 'content-type': 'application/a-gzip' } }) : Response.json({ errors: [{ code: 'NOT_FOUND', detail: 'There were no sales for the date specified.' }] }, { status: 404 })
  }) as unknown as typeof fetch
  return calls
}

const credentials = () => ({ issuerId, keyId, vendorNumber: '12345678', privateKey: p8 })
const later = () => Date.now() + 60_000
const run = (extra: { cursor?: Record<string, unknown>, reset?: boolean, deadline?: number } = {}) => {
  const saved: string[][] = []
  const result = appleAdapter.sync({ credentials: credentials(), cursor: {}, reset: false, deadline: later(), savePayments: async (rows) => { saved.push(rows.map(r => r.stripeId)) }, saveSubscriptions: async () => {}, ...extra })
  return { saved, result }
}

describe('connecting', () => {
  test('malformed fields are a 400 before any request is made', async () => {
    const calls = fakeApple()
    for (const bad of [{ issuerId: 'nope' }, { keyId: 'abc' }, { vendorNumber: '12x' }, { vendorNumber: '' }, { privateKey: 'hello' }]) {
      await expect(appleAdapter.check({ ...credentials(), ...bad })).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(calls.length).toBe(0)
  })

  test('asks for the newest report, names the vendor, and treats "no report" as fine', async () => {
    const calls = fakeApple()
    expect(await appleAdapter.check(credentials())).toEqual({ accountName: 'Vendor 12345678', livemode: true })
    expect(calls.length).toBe(1)
    expect(calls[0]!.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    const q = calls[0]!.url.searchParams
    expect(calls[0]!.url.origin + calls[0]!.url.pathname).toBe('https://api.appstoreconnect.apple.com/v1/salesReports')
    expect(Object.fromEntries(q)).toEqual({
      'filter[reportType]': 'SALES', 'filter[reportSubType]': 'SUMMARY', 'filter[frequency]': 'DAILY',
      'filter[vendorNumber]': '12345678', 'filter[reportDate]': lastReportDay(), 'filter[version]': '1_0'
    })
  })

  test('a refused key is a 502 that says what Apple answered', async () => {
    fakeApple({}, 401)
    await expect(appleAdapter.check(credentials())).rejects.toMatchObject({ statusCode: 502, statusMessage: expect.stringContaining('Apple answered 401: Provide a properly configured') })
  })
})

describe('syncing', () => {
  test('the first run reads the last year, day by day, and saves the days that had sales', async () => {
    const last = lastReportDay()
    const calls = fakeApple({ [last]: report(sale({ SKU: 'a', Units: '2', 'Developer Proceeds': '0.70', 'Currency of Proceeds': 'USD' })) })
    const { saved, result } = run()
    expect(await result).toEqual({ cursor: { day: last }, done: true })
    expect(calls.length).toBe(365)
    expect(calls[0]!.day).toBe(addDays(last, -364))
    expect(calls.at(-1)!.day).toBe(last)
    expect(saved).toEqual([[`apple:${last}:a:usd`]])
  })

  test('"Sync everything" ignores the cursor', async () => {
    const calls = fakeApple()
    await run({ cursor: { day: lastReportDay() }, reset: true }).result
    expect(calls.length).toBe(365)
  })

  test('a finished run starts again a few days back, and re-reading a day writes the same ids', async () => {
    const last = lastReportDay()
    const day = report(sale({ SKU: 'a', Units: '2', 'Developer Proceeds': '0.70', 'Currency of Proceeds': 'USD' }))
    const calls = fakeApple({ [last]: day })
    const first = run({ cursor: { day: addDays(last, -10) } })
    expect(await first.result).toEqual({ cursor: { day: last }, done: true })
    expect(calls.map(c => c.day)).toEqual(Array.from({ length: 14 }, (_, i) => addDays(last, i - 13)))
    const again = run({ cursor: { day: last } })
    await again.result
    expect(again.saved).toEqual(first.saved)
    expect(calls.slice(-4).map(c => c.day)).toEqual([-3, -2, -1, 0].map(n => addDays(last, n)))
  })

  test('at the deadline it stops after the day it is on and resumes on the next one', async () => {
    const last = lastReportDay()
    const first = addDays(last, -364)
    const calls = fakeApple()
    const stopped = await run({ deadline: Date.now() - 1 }).result
    expect(stopped).toEqual({ cursor: { day: first, partial: true }, done: false })
    expect(calls.length).toBe(1)
    await run({ cursor: stopped.cursor }).result
    expect(calls[1]!.day).toBe(addDays(first, 1))
    expect(calls.length).toBe(1 + 364)
  })

  test('a cursor older than Apple keeps reports for starts at the oldest day it has', async () => {
    const calls = fakeApple()
    await run({ cursor: { day: '2020-01-01' } }).result
    expect(calls.length).toBe(365)
  })

  test('an error from Apple stops the run', async () => {
    fakeApple({}, 403)
    await expect(run().result).rejects.toMatchObject({ statusCode: 502, statusMessage: expect.stringContaining('403') })
  })
})
