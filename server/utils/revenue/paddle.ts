import { createError } from 'h3'
import { monthlyMinor } from '#shared/stripe'
import { monthOf, revenuePaymentRow, revenueSubscriptionRow } from './rows'
import type { PullAdapter } from './types'

// Paddle Billing, read only. A server API key (read access to Transactions, Subscriptions,
// Customers and Adjustments) is sent as a Bearer token to one of two fixed hosts, picked by the
// key's prefix. The orchestrator (server/utils/revenue.ts) owns the schedule and the row;
// this file knows Paddle's API and how to turn it into rows.
//
// A run walks transactions newest first from the cursor (30 a page, Paddle's maximum), looks up
// the refunds of the ones that were paid, then re-reads every subscription. Later runs only look
// at transactions touched in the last REFRESH_DAYS, which is how refunds on recent ones are
// picked up; "Sync everything" starts over.

const LIVE = 'https://api.paddle.com'
const SANDBOX = 'https://sandbox-api.paddle.com'
const REFRESH_DAYS = 35
const DAY = 86_400

type Cursor = { since?: number, after?: string, startedAt?: number }

/** Which Paddle host a key belongs to, or null when it is not a Paddle API key. A sandbox key never reaches the live host. */
export function paddleTarget(key: string): { host: string, livemode: boolean } | null {
  const match = /^pdl_(live|sdbx)_apikey_[\w-]{10,}$/.exec(key)
  return match ? { host: match[1] === 'live' ? LIVE : SANDBOX, livemode: match[1] === 'live' } : null
}

function targetOf(credentials: Record<string, string>) {
  const key = (credentials.apiKey || '').trim()
  const target = paddleTarget(key)
  if (!target) throw createError({ statusCode: 400, statusMessage: 'Paste a Paddle API key (pdl_live_apikey_… or pdl_sdbx_apikey_…) with read access' })
  return { key, ...target }
}

type Api = { key: string, host: string }

async function paddleGet({ key, host }: Api, path: string, params: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${host}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: `Paddle answered ${res.status}: ${String(body?.error?.detail || res.statusText).slice(0, 200)}`, data: { status: res.status } })
  return body
}

/** Every page of a Paddle list, starting after `after`. Paddle's `meta.pagination.next` is `after` set to the last id of the page. */
async function* pages(api: Api, path: string, params: Record<string, string> = {}, after = ''): AsyncGenerator<any[]> {
  for (;;) {
    const body = await paddleGet(api, path, { ...params, ...(after ? { after } : {}) })
    const data = (body.data || []) as any[]
    if (data.length) yield data
    if (!body.meta?.pagination?.has_more || !data.length) return
    after = data.at(-1).id
  }
}

const sec = (value: unknown) => Math.floor(Date.parse(String(value ?? '')) / 1000) || 0
/** Paddle's filters take RFC 3339 datetimes. */
const stamp = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z')

// ---- mapping -------------------------------------------------------------------

/**
 * A transaction as a payment. Amounts are strings in the currency's smallest unit, like Stripe's.
 * `amount` is `details.totals.grand_total`: what the customer was asked to pay after discount, tax and
 * any account credit applied (`total` ignores credit; `earnings` is net of Paddle's fee and is null
 * until Paddle has processed it). It includes tax, as a Stripe charge does, and so do the refunds
 * (an adjustment's `totals.total`), so `net` stays consistent. Fees and payouts are not modelled.
 */
export function paddlePaymentRow(txn: any, refunded = 0) {
  const line = txn.details?.line_items?.[0]
  return revenuePaymentRow('paddle', {
    id: String(txn.id),
    customerId: String(txn.customer_id || ''),
    email: txn.customer?.email,
    // A subscription update can come out negative (credit to balance): nobody was charged.
    amount: Math.max(0, Number(txn.details?.totals?.grand_total) || 0),
    currency: String(txn.currency_code || txn.details?.currency_code || ''),
    paidAtSec: sec(txn.billed_at) || sec(txn.created_at),
    // `paid` is paid but not yet processed by Paddle, `completed` is processed; the rest (past_due, billed, canceled) are kept but add nothing.
    status: txn.status === 'completed' || txn.status === 'paid' ? 'succeeded' : String(txn.status || 'unknown'),
    refunded,
    description: String(line?.product?.name || txn.items?.[0]?.price?.name || ''),
    invoiceId: String(txn.invoice_number || '')
  })
}

/** What each transaction gave back: the approved refunds, summed per transaction. Credits and chargebacks are not refunds. */
export function refundTotals(adjustments: any[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of adjustments) {
    if (a.action !== 'refund' || a.status !== 'approved') continue
    out.set(String(a.transaction_id), (out.get(String(a.transaction_id)) || 0) + (Number(a.totals?.total) || 0))
  }
  return out
}

/**
 * A subscription as a row. Paddle's statuses (active, trialing, past_due, paused, canceled) are
 * already the ones in shared/stripe.ts. Every recurring item shares the subscription's billing cycle.
 */
export function paddleSubscriptionRow(sub: any, email = '') {
  const items = (sub.items || []) as any[]
  const cycle = sub.billing_cycle || {}
  const priced = items.map(item => ({
    quantity: item.quantity,
    price: { unit_amount: Number(item.price?.unit_price?.amount) || 0, recurring: { interval: cycle.interval, interval_count: cycle.frequency } }
  }))
  const monthly = monthlyMinor(priced)
  const started = sec(sub.started_at) || sec(sub.first_billed_at) || sec(sub.created_at)
  const trialEnd = Math.max(0, ...items.map(item => sec(item.trial_dates?.ends_at)))
  const canceled = sec(sub.canceled_at)
  const first = items[0]
  return revenueSubscriptionRow('paddle', {
    id: String(sub.id),
    customerId: String(sub.customer_id || ''),
    email,
    status: String(sub.status || ''),
    plan: String(first?.product?.name || first?.price?.name || ''),
    currency: String(sub.currency_code || ''),
    amount: priced.reduce((sum, item) => sum + item.price.unit_amount * (item.quantity ?? 1), 0),
    monthly,
    interval: String(cycle.interval || ''),
    intervalCount: Number(cycle.frequency) || 1,
    startedAtSec: started,
    canceledAtSec: canceled,
    currentPeriodEndSec: sec(sub.current_billing_period?.ends_at),
    cancelAtPeriodEnd: sub.scheduled_change?.action === 'cancel',
    // Paying starts at the first bill, which a trial pushes past the start.
    paidFromMonth: monthOf(sec(sub.first_billed_at) || Math.max(started, trialEnd)),
    // ponytail: `canceled_at` is the month it was canceled; if Paddle stamps a scheduled cancel with the day it was asked for, that month is early by the rest of the paid period.
    endedMonth: sub.status === 'canceled' && canceled ? monthOf(canceled) : ''
  })
}

// ---- reading -------------------------------------------------------------------

async function refundsOf(api: Api, transactionIds: string[]): Promise<Map<string, number>> {
  if (!transactionIds.length) return new Map()
  const adjustments: any[] = []
  for await (const page of pages(api, '/adjustments', { transaction_id: transactionIds.join(','), action: 'refund', status: 'approved', per_page: '50' })) adjustments.push(...page)
  return refundTotals(adjustments)
}

/** Fills `emails` for the customers it does not know yet (a subscription names its customer by id only; a transaction brings the customer with `include=customer`). */
async function learnEmails(api: Api, emails: Map<string, string>, ids: string[]) {
  const missing = [...new Set(ids.filter(id => id && !emails.has(id)))]
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100)
    // Customers who were archived in Paddle still have subscriptions.
    const body = await paddleGet(api, '/customers', { id: chunk.join(','), status: 'active,archived', per_page: '200' })
    for (const customer of body.data || []) emails.set(String(customer.id), String(customer.email || ''))
    for (const id of chunk) if (!emails.has(id)) emails.set(id, '')
  }
}

export const paddleAdapter: PullAdapter = {
  id: 'paddle',

  async check(credentials) {
    const api = targetOf(credentials)
    // The sync reads all four; a key missing one is refused now, not at the first run. Paddle has no endpoint that names the seller.
    await Promise.all(['/transactions', '/subscriptions', '/customers', '/adjustments'].map(path => paddleGet(api, path, { per_page: '1' })))
    return { accountName: 'Paddle', livemode: api.livemode }
  },

  async sync(ctx) {
    const api = targetOf(ctx.credentials)
    const cursor = (ctx.reset ? {} : ctx.cursor) as Cursor
    const since = cursor.since || 0
    const startedAt = cursor.startedAt ?? Math.floor(Date.now() / 1000)
    const emails = new Map<string, string>()
    let after = cursor.after || ''
    let done = true

    // draft and ready are checkouts nobody has paid or been billed for yet; they would only add rows.
    const params = { per_page: '30', include: 'customer', status: 'billed,paid,completed,canceled,past_due', ...(since ? { 'updated_at[GTE]': stamp(since) } : {}) }
    try {
      for await (const page of pages(api, '/transactions', params, after)) {
        const paid = page.filter(txn => txn.status === 'completed' || txn.status === 'paid')
        const refunds = await refundsOf(api, paid.map(txn => String(txn.id)))
        // A paid transaction for nothing (fully discounted or covered by credit) is not a payment.
        await ctx.savePayments(page.map(txn => paddlePaymentRow(txn, refunds.get(String(txn.id)))).filter(row => row.amount > 0 || row.status !== 'succeeded'))
        after = String(page.at(-1).id)
        if (Date.now() > ctx.deadline) { done = false; break }
      }
    } catch (error) {
      // Paddle allows 240 requests a minute and then refuses for a minute: carry on from the last page on the next tick.
      if ((error as { data?: { status?: number } }).data?.status !== 429 || !after) throw error
      done = false
    }
    if (!done) return { cursor: { since, startedAt, after }, done }

    // ponytail: not resumable; subscriptions are 200 a page, so even a large account is a few dozen requests.
    for await (const page of pages(api, '/subscriptions', { per_page: '200', status: 'active,trialing,past_due,paused,canceled' })) {
      await learnEmails(api, emails, page.map(sub => String(sub.customer_id || '')))
      await ctx.saveSubscriptions(page.map(sub => paddleSubscriptionRow(sub, emails.get(String(sub.customer_id)))))
    }
    // ponytail: a refund older than REFRESH_DAYS is missed until "Sync everything".
    return { cursor: { since: Math.max(0, startedAt - REFRESH_DAYS * DAY) }, done: true }
  }
}
