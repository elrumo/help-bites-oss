import { gunzipSync } from 'node:zlib'
import { createError } from 'h3'
import { toMinor } from '#shared/stripe'
import { revenuePaymentRow, type PaymentRow } from './rows'
import type { Credentials, PullAdapter } from './types'

// Apple App Store Connect, read only: the Sales and Trends "Summary Sales" report, one gzip'd
// TSV per day (GET /v1/salesReports), signed in with a JWT made from the team's API key (.p8).
// Apple reports proceeds (the customer's price minus tax and Apple's commission), unlike
// RevenueCat's gross price, so these totals are lower than the price the customer paid.
// A refund is its own line with negative Units and a positive Developer Proceeds, so
// units * proceeds is already negative and nets against the sales. Customers are not revealed.
// Only payments: the Summary report has no subscriber or renewal state, so no MRR.
//
// A day is requested as Apple's report date (Pacific time). The cursor is `{ day }`, the last
// day read; `partial` marks a run the deadline cut short, which resumes on the next day. A
// finished run starts again REREAD_DAYS back, because Apple revises recent days.

const API = 'https://api.appstoreconnect.apple.com/v1/salesReports'
/** Apple keeps daily reports for a year after they are published. */
const WINDOW_DAYS = 365
const REREAD_DAYS = 3
/** Apple refuses a token that lives longer than 20 minutes. One token covers a run (the deadline is seconds away). */
const TOKEN_SECONDS = 15 * 60
const DAY = /^\d{4}-\d{2}-\d{2}$/

const SHAPES = {
  issuerId: { re: /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, hint: 'the Issuer ID (a UUID, on Users and Access > Integrations)' },
  keyId: { re: /^[A-Z0-9]{10}$/, hint: 'the Key ID (10 letters and digits)' },
  vendorNumber: { re: /^\d{4,12}$/, hint: 'the Vendor Number (digits only, under Payments and Financial Reports)' }
} as const

function parseCredentials(raw: Credentials) {
  const out = { issuerId: '', keyId: '', vendorNumber: '', privateKey: String(raw.privateKey ?? '') }
  for (const [key, { re, hint }] of Object.entries(SHAPES)) {
    const value = String(raw[key] ?? '').trim()
    if (!re.test(value)) throw createError({ statusCode: 400, statusMessage: `Check ${hint}` })
    out[key as keyof typeof SHAPES] = value
  }
  return out
}

// ---- signing in ---------------------------------------------------------------

/** The base64 body of a pasted .p8, however it got mangled: literal "\n", no line breaks, quotes, CRLF, no header. */
export function p8Body(text: string): string {
  const raw = text.replace(/\\[rn]/g, '\n')
  const kind = raw.match(/-----BEGIN ([A-Z ]+)-----/)?.[1]
  const body = raw.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/[\s"']/g, '')
  if ((kind && kind !== 'PRIVATE KEY') || !/^[A-Za-z0-9+/]{80,}={0,2}$/.test(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Paste the whole .p8 file, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----' })
  }
  return body
}

const b64url = (data: string | Uint8Array) => Buffer.from(data).toString('base64url')

/** A JWT for App Store Connect: ES256, signed with the .p8 (WebCrypto already returns the raw r||s a JWT wants). */
export async function appleToken(c: { issuerId: string, keyId: string, privateKey: string }, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const der = new Uint8Array(Buffer.from(p8Body(c.privateKey), 'base64'))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    .catch(() => { throw createError({ statusCode: 400, statusMessage: 'That private key could not be read: paste the .p8 App Store Connect gave you' }) })
  const input = `${b64url(JSON.stringify({ alg: 'ES256', kid: c.keyId, typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: c.issuerId, iat: nowSec, exp: nowSec + TOKEN_SECONDS, aud: 'appstoreconnect-v1' }))}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new Uint8Array(Buffer.from(input)))
  return `${input}.${b64url(new Uint8Array(signature))}`
}

// ---- days ----------------------------------------------------------------------

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** The newest day worth asking for: yesterday in Pacific time, when Apple's day ends (it publishes by 8 a.m. PT the day after). */
export function lastReportDay(now = new Date()): string {
  return addDays(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now), -1)
}

// ---- reading -------------------------------------------------------------------

/** One day's report as text; null when Apple has none (no sales that day, or not published yet). */
async function salesReport(token: string, vendorNumber: string, day: string): Promise<string | null> {
  const query = new URLSearchParams({
    'filter[reportType]': 'SALES', 'filter[reportSubType]': 'SUMMARY', 'filter[frequency]': 'DAILY',
    'filter[vendorNumber]': vendorNumber, 'filter[reportDate]': day, 'filter[version]': '1_0'
  })
  const res = await fetch(`${API}?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  // Not an error: a quiet day, or one Apple has not published yet.
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { errors?: { detail?: string, title?: string }[] }
    const why = body.errors?.[0]?.detail || body.errors?.[0]?.title || res.statusText
    const hint = res.status === 401 || res.status === 403 ? ' (check the issuer ID, key ID and vendor number, and that the key can read Sales and Trends)' : ''
    throw createError({ statusCode: 502, statusMessage: `Apple answered ${res.status}: ${String(why).slice(0, 200)}${hint}` })
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  // The body is a gzip file; sniff it in case a proxy already unpacked it.
  return new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes)
}

// ponytail: a group that disappears when Apple revises a day keeps its old row (rows are upserted, never removed).
/**
 * One day's TSV as payment rows: one per (SKU, currency of proceeds), the sum of units * developer
 * proceeds in that currency's smallest unit. Free apps, updates and sales that a refund cancelled
 * add nothing and are left out.
 */
export function salesRows(tsv: string, day: string): PaymentRow[] {
  if (!tsv.trim()) return []
  const [head, ...lines] = tsv.replace(/^\uFEFF/, '').split(/\r?\n/)
  // The docs call the column "Developer Proceeds (per unit)"; the file has had both spellings.
  const cols = (head || '').split('\t').map(h => h.replace(/\s*\(.*\)\s*$/, '').trim())
  const need = (name: string) => {
    const at = cols.indexOf(name)
    if (at < 0) throw createError({ statusCode: 502, statusMessage: `Apple's sales report has no "${name}" column` })
    return at
  }
  const [sku, units, proceeds, currency] = ['SKU', 'Units', 'Developer Proceeds', 'Currency of Proceeds'].map(need) as [number, number, number, number]
  const title = cols.indexOf('Title')
  const subscription = cols.indexOf('Subscription')

  const groups = new Map<string, { sku: string, title: string, currency: string, amount: number, kinds: Set<string> }>()
  for (const line of lines) {
    const f = line.split('\t')
    const n = Number(f[units])
    const per = Number(f[proceeds] || 0)
    const cur = (f[currency] || '').trim().toLowerCase()
    if (!Number.isFinite(n) || !Number.isFinite(per) || !/^[a-z]{3}$/.test(cur)) continue
    const id = (f[sku] || '').trim()
    const group = groups.get(`${id}\t${cur}`) || groups.set(`${id}\t${cur}`, { sku: id, title: (f[title] || '').trim(), currency: cur, amount: 0, kinds: new Set() }).get(`${id}\t${cur}`)!
    group.amount += toMinor(n * per, cur)
    const kind = (f[subscription] || '').trim().toLowerCase()
    if (kind) group.kinds.add(kind)
  }
  return [...groups.values()].filter(g => g.amount !== 0).map((g) => {
    const name = g.title || g.sku
    return revenuePaymentRow('apple', {
      id: `${day}:${g.sku}:${g.currency}`, amount: g.amount, currency: g.currency,
      paidAtSec: Date.parse(`${day}T00:00:00Z`) / 1000,
      description: g.kinds.size ? `${name} (subscription ${[...g.kinds].join(' + ')})` : name
    })
  })
}

export const appleAdapter: PullAdapter = {
  id: 'apple',

  async check(credentials) {
    const c = parseCredentials(credentials)
    // One request for the newest day: a missing report is fine (404), a refused key is not.
    await salesReport(await appleToken(c), c.vendorNumber, lastReportDay())
    return { accountName: `Vendor ${c.vendorNumber}`, livemode: true }
  },

  // ponytail: one request at a time (a year of history is a few minutes over several runs); read days in parallel if that is too slow.
  async sync({ credentials, cursor, reset, deadline, savePayments }) {
    const c = parseCredentials(credentials)
    const last = lastReportDay()
    const first = addDays(last, 1 - WINDOW_DAYS)
    const read = !reset && typeof cursor.day === 'string' && DAY.test(cursor.day) ? cursor.day : ''
    let day = read ? addDays(read, cursor.partial ? 1 : -REREAD_DAYS) : first
    if (day < first) day = first
    const token = await appleToken(c)
    for (; day <= last; day = addDays(day, 1)) {
      const tsv = await salesReport(token, c.vendorNumber, day)
      const rows = tsv ? salesRows(tsv, day) : []
      if (rows.length) await savePayments(rows)
      if (day < last && Date.now() > deadline) return { cursor: { day, partial: true }, done: false }
    }
    return { cursor: { day: last }, done: true }
  }
}
