import { afterEach, describe, expect, test } from 'bun:test'
import { paddleAdapter, paddlePaymentRow, paddleSubscriptionRow, paddleTarget, refundTotals } from '../server/utils/revenue/paddle'
import type { PullContext } from '../server/utils/revenue/types'

// Fixtures follow the example responses in Paddle's API reference (List transactions, List
// adjustments, List subscriptions). Nothing here talks to Paddle: it shows the mapping matches the
// documented shapes, not that a live account behaves the same.

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)

const txn = (over: Record<string, unknown> = {}) => ({
  id: 'txn_01h04vsbhqc62t8hmd4z3b578c', status: 'completed', customer_id: 'ctm_01grnn4zta5a1mf02jjze7y2ys',
  customer: { id: 'ctm_01grnn4zta5a1mf02jjze7y2ys', name: 'Ada Lovelace', email: 'Ada@Example.com' },
  currency_code: 'USD', origin: 'subscription_recurring', invoice_number: '123-45678',
  billed_at: '2024-10-12T07:20:50.52Z', created_at: '2024-10-12T07:20:00Z', updated_at: '2024-10-13T07:20:50.52Z',
  items: [{ price: { id: 'pri_1', name: 'Monthly', product_id: 'pro_1' }, quantity: 1 }],
  details: {
    currency_code: 'USD', fee: '825', earnings: '15675',
    totals: { subtotal: '15000', discount: '0', tax: '1500', total: '16500', credit: '0', credit_to_balance: '0', balance: '0', grand_total: '16500' },
    line_items: [{ price_id: 'pri_1', quantity: 1, tax_rate: '0.1', totals: { subtotal: '15000', tax: '1500', total: '16500' }, product: { id: 'pro_1', name: 'AeroEdit Pro' } }]
  },
  ...over
})

const adjustment = (over: Record<string, unknown> = {}) => ({
  id: 'adj_1', action: 'refund', type: 'partial', status: 'approved', transaction_id: 'txn_01h04vsbhqc62t8hmd4z3b578c', currency_code: 'USD',
  totals: { subtotal: '3636', tax: '364', total: '4000', fee: '0', earnings: '0', currency_code: 'USD' }, ...over
})

const sub = (over: Record<string, unknown> = {}) => ({
  id: 'sub_01hv959anj4zrw503h2acawb3p', status: 'active', customer_id: 'ctm_01hv8wt8nffez4p2t6typn4a5j', currency_code: 'USD',
  created_at: '2024-04-12T12:42:27.89Z', started_at: '2024-04-12T12:42:27.185672Z', first_billed_at: '2024-04-12T12:42:27.185672Z',
  next_billed_at: '2024-05-12T12:44:51.27Z', paused_at: null, canceled_at: null,
  current_billing_period: { starts_at: '2024-04-12T12:44:51.27Z', ends_at: '2024-05-12T12:44:51.27Z' },
  billing_cycle: { frequency: 1, interval: 'month' }, scheduled_change: null,
  items: [{
    status: 'active', quantity: 2, recurring: true, trial_dates: null,
    price: { name: 'Monthly (per seat)', unit_price: { amount: '3000', currency_code: 'USD' }, billing_cycle: { frequency: 1, interval: 'month' }, trial_period: null },
    product: { name: 'AeroEdit Pro' }
  }],
  ...over
})

describe('paddle host and key', () => {
  test('the prefix picks the host; nothing else can', () => {
    expect(paddleTarget('pdl_live_apikey_01hv959anj4zrw503h2acawb3p_P2HbKQ2aSHG92n6kmeHcp_A6a')).toEqual({ host: 'https://api.paddle.com', livemode: true })
    expect(paddleTarget('pdl_sdbx_apikey_01hv959anj4zrw503h2acawb3p_P2HbKQ2aSHG92n6kmeHcp_A6a')).toEqual({ host: 'https://sandbox-api.paddle.com', livemode: false })
    for (const bad of ['', 'rk_live_abcdefghijklmnop', 'pdl_live_apikey_', 'pdl_live_apikey_short', 'pdl_test_apikey_01hv959anj4zrw503h2acawb3p', 'xpdl_live_apikey_01hv959anj4zrw503h2acawb3p', 'pdl_live_apikey_01hv959anj4zrw503h2acawb3p ', 'pdl_live_apikey_01hv959anj4z@evil.com/']) {
      expect(paddleTarget(bad)).toBeNull()
    }
  })
})

describe('paddle transactions', () => {
  test('a paid transaction with tax is the grand total, with its customer, product and invoice', () => {
    expect(paddlePaymentRow(txn())).toMatchObject({
      stripeId: 'paddle:txn_01h04vsbhqc62t8hmd4z3b578c', source: 'paddle', customerId: 'ctm_01grnn4zta5a1mf02jjze7y2ys', email: 'ada@example.com',
      status: 'succeeded', currency: 'usd', amount: 16500, refunded: 0, net: 16500, paidAtSec: at('2024-10-12T07:20:50.52Z'), month: '2024-10',
      description: 'AeroEdit Pro', invoiceId: '123-45678'
    })
  })

  test('paid and completed both count; a billed, canceled or past due one is kept but adds nothing', () => {
    expect(paddlePaymentRow(txn({ status: 'paid' })).net).toBe(16500)
    for (const status of ['past_due', 'billed', 'canceled']) expect(paddlePaymentRow(txn({ status }))).toMatchObject({ status, net: 0, amount: 16500 })
  })

  test('refunds come off what stayed and never below nothing', () => {
    expect(paddlePaymentRow(txn(), 4000)).toMatchObject({ amount: 16500, refunded: 4000, net: 12500 })
    expect(paddlePaymentRow(txn(), 16500).net).toBe(0)
    expect(paddlePaymentRow(txn(), 99999)).toMatchObject({ refunded: 16500, net: 0 })
  })

  test('only approved refunds are summed, per transaction', () => {
    const refunds = refundTotals([
      adjustment(),
      adjustment({ id: 'adj_2', totals: { total: '1000' } }),
      adjustment({ id: 'adj_3', status: 'pending_approval' }),
      adjustment({ id: 'adj_4', status: 'rejected' }),
      adjustment({ id: 'adj_5', status: 'reversed' }),
      adjustment({ id: 'adj_6', action: 'credit' }),
      adjustment({ id: 'adj_7', action: 'chargeback' }),
      adjustment({ id: 'adj_8', transaction_id: 'txn_other', totals: { total: '250' } })
    ])
    expect(refunds.get('txn_01h04vsbhqc62t8hmd4z3b578c')).toBe(5000)
    expect(refunds.get('txn_other')).toBe(250)
    expect(refunds.size).toBe(2)
  })

  test('credit to the balance is not a charge; a missing price name or customer is fine', () => {
    const credit = txn({ details: { currency_code: 'USD', totals: { total: '-500', grand_total: '-500' }, line_items: [] }, customer: undefined, customer_id: null })
    expect(paddlePaymentRow(credit)).toMatchObject({ amount: 0, net: 0, customerId: '', email: '', description: 'Monthly' })
  })
})

describe('paddle subscriptions', () => {
  test('an active monthly one with two seats', () => {
    expect(paddleSubscriptionRow(sub(), 'ada@example.com')).toMatchObject({
      stripeId: 'paddle:sub_01hv959anj4zrw503h2acawb3p', source: 'paddle', customerId: 'ctm_01hv8wt8nffez4p2t6typn4a5j', email: 'ada@example.com',
      status: 'active', plan: 'AeroEdit Pro', currency: 'usd', amount: 6000, interval: 'month', intervalCount: 1, mrr: 6000, monthly: 6000,
      startedAtSec: at('2024-04-12T12:42:27.185Z'), canceledAtSec: 0, currentPeriodEndSec: at('2024-05-12T12:44:51.27Z'), cancelAtPeriodEnd: false,
      paidFromMonth: '2024-04', endedMonth: ''
    })
  })

  test('a trialing yearly one is not MRR yet and starts paying when the trial ends', () => {
    const trialing = sub({
      status: 'trialing', started_at: '2024-04-17T09:00:00Z', first_billed_at: null, billing_cycle: { frequency: 1, interval: 'year' },
      current_billing_period: { starts_at: '2024-04-17T09:00:00Z', ends_at: '2024-05-01T09:00:00Z' },
      items: [{
        status: 'trialing', quantity: 1, recurring: true, trial_dates: { starts_at: '2024-04-17T09:00:00Z', ends_at: '2024-05-01T09:00:00Z' },
        price: { name: 'Yearly', unit_price: { amount: '12000', currency_code: 'USD' }, billing_cycle: { frequency: 1, interval: 'year' }, trial_period: { frequency: 14, interval: 'day' } },
        product: { name: 'AeroEdit Pro' }
      }]
    })
    expect(paddleSubscriptionRow(trialing)).toMatchObject({ status: 'trialing', amount: 12000, monthly: 1000, mrr: 0, interval: 'year', paidFromMonth: '2024-05', endedMonth: '' })
  })

  test('a canceled one has no period left and ended the month it was canceled', () => {
    const canceled = sub({
      status: 'canceled', canceled_at: '2024-08-20T10:00:00Z', current_billing_period: null, next_billed_at: null,
      items: [{ status: 'active', quantity: 1, recurring: true, trial_dates: null, price: { name: 'Monthly', unit_price: { amount: '900', currency_code: 'USD' } }, product: { name: 'AeroEdit Lite' } }]
    })
    expect(paddleSubscriptionRow(canceled)).toMatchObject({
      status: 'canceled', plan: 'AeroEdit Lite', mrr: 0, monthly: 900, canceledAtSec: at('2024-08-20T10:00:00Z'), currentPeriodEndSec: 0, paidFromMonth: '2024-04', endedMonth: '2024-08'
    })
  })

  test('a scheduled cancel still pays; a quarterly price is a third a month; a paused one keeps its price but pays nothing', () => {
    const leaving = paddleSubscriptionRow(sub({ scheduled_change: { action: 'cancel', effective_at: '2024-05-12T12:44:51.27Z', resume_at: null } }))
    expect(leaving).toMatchObject({ cancelAtPeriodEnd: true, mrr: 6000, endedMonth: '' })
    const quarterly = sub({ billing_cycle: { frequency: 3, interval: 'month' }, items: [{ ...sub().items[0], quantity: 1 }] })
    expect(paddleSubscriptionRow(quarterly)).toMatchObject({ interval: 'month', intervalCount: 3, amount: 3000, monthly: 1000, mrr: 1000 })
    const paused = sub({ status: 'paused', paused_at: '2024-06-01T00:00:00Z', current_billing_period: null, items: [{ ...sub().items[0], status: 'inactive' }] })
    expect(paddleSubscriptionRow(paused)).toMatchObject({ status: 'paused', mrr: 0, monthly: 6000 })
  })

  test('a status Paddle may add later does not break the row', () => {
    expect(paddleSubscriptionRow(sub({ status: 'something_new' })).status).toBe('incomplete')
  })
})

// ---- the adapter, against a Paddle that answers as documented -------------------

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

type Call = { url: URL, authorization: string }

/** Answers from `answer(url)`; a number is an error status. */
function fakePaddle(answer: (url: URL) => unknown) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, authorization: String((init?.headers as Record<string, string>)?.authorization) })
    const body = answer(url)
    return typeof body === 'number' ? new Response(JSON.stringify({ error: { type: 'request_error', code: 'x', detail: 'Nope' } }), { status: body }) : new Response(JSON.stringify(body))
  }) as typeof fetch
  return calls
}

const KEY = 'pdl_sdbx_apikey_01hv959anj4zrw503h2acawb3p_P2HbKQ2aSHG92n6kmeHcp_A6a'
const list = (data: unknown[], hasMore = false) => ({ data, meta: { pagination: { per_page: 30, has_more: hasMore, next: 'https://sandbox-api.paddle.com/x' } } })

function context(over: Partial<PullContext> = {}) {
  const saved = { payments: [] as any[], subscriptions: [] as any[] }
  const ctx: PullContext = {
    credentials: { apiKey: KEY }, cursor: {}, reset: false, deadline: Date.now() + 60_000,
    savePayments: async (rows) => { saved.payments.push(...rows) },
    saveSubscriptions: async (rows) => { saved.subscriptions.push(...rows) },
    ...over
  }
  return { ctx, saved }
}

const t1 = txn({ id: 'txn_1' })
const t2 = txn({ id: 'txn_2', status: 'past_due' })
const t3 = txn({ id: 'txn_3', details: { currency_code: 'USD', totals: { grand_total: '1000' }, line_items: [] }, customer: { id: 'ctm_3', email: 'g@example.com' }, customer_id: 'ctm_3' })

const account = (url: URL): unknown => {
  const after = url.searchParams.get('after')
  if (url.pathname === '/transactions') return after === 'txn_2' ? list([t3]) : list([t1, t2], true)
  if (url.pathname === '/adjustments') return list(url.searchParams.get('transaction_id')!.includes('txn_3') ? [adjustment({ transaction_id: 'txn_3', totals: { total: '400' } })] : [])
  if (url.pathname === '/subscriptions') return list([sub({ id: 'sub_1', customer_id: 'ctm_a' }), sub({ id: 'sub_2', customer_id: 'ctm_b', status: 'trialing' })])
  if (url.pathname === '/customers') return list([{ id: 'ctm_a', email: 'A@example.com' }, { id: 'ctm_b', email: 'b@example.com' }])
  return 404
}

describe('paddle adapter', () => {
  test('connecting checks the four lists the sync reads, on the host the key belongs to', async () => {
    const calls = fakePaddle(() => list([]))
    expect(await paddleAdapter.check({ apiKey: ` ${KEY} ` })).toEqual({ accountName: 'Paddle', livemode: false })
    expect(calls.map(c => c.url.pathname).sort()).toEqual(['/adjustments', '/customers', '/subscriptions', '/transactions'])
    expect(calls.every(c => c.url.origin === 'https://sandbox-api.paddle.com' && c.authorization === `Bearer ${KEY}` && c.url.searchParams.get('per_page') === '1')).toBe(true)

    const live = fakePaddle(() => list([]))
    expect(await paddleAdapter.check({ apiKey: 'pdl_live_apikey_01hv959anj4zrw503h2acawb3p_P2HbKQ2aSHG92n6kmeHcp_A6a' })).toMatchObject({ livemode: true })
    expect(live.every(c => c.url.origin === 'https://api.paddle.com')).toBe(true)
  })

  test('a malformed key is a 400 and never reaches the network; a refused one is a 502', async () => {
    const calls = fakePaddle(() => list([]))
    await expect(paddleAdapter.check({ apiKey: 'sk_live_whatever_1234567890' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(paddleAdapter.check({})).rejects.toMatchObject({ statusCode: 400 })
    expect(calls.length).toBe(0)
    fakePaddle(() => 403)
    await expect(paddleAdapter.check({ apiKey: KEY })).rejects.toMatchObject({ statusCode: 502, statusMessage: 'Paddle answered 403: Nope' })
  })

  test('a first run reads everything: refunds on the paid, emails for the subscribers, then continues from 35 days back', async () => {
    const calls = fakePaddle(account)
    const { ctx, saved } = context()
    const now = Math.floor(Date.now() / 1000)
    const result = await paddleAdapter.sync(ctx)

    expect(result.done).toBe(true)
    expect(Math.abs((result.cursor.since as number) - (now - 35 * 86_400))).toBeLessThan(5)
    expect(saved.payments.map(p => [p.stripeId, p.status, p.amount, p.refunded, p.net])).toEqual([
      ['paddle:txn_1', 'succeeded', 16500, 0, 16500], ['paddle:txn_2', 'past_due', 16500, 0, 0], ['paddle:txn_3', 'succeeded', 1000, 400, 600]
    ])
    expect(saved.payments[0].email).toBe('ada@example.com')
    expect(saved.subscriptions.map(s => [s.stripeId, s.email, s.status, s.mrr])).toEqual([['paddle:sub_1', 'a@example.com', 'active', 6000], ['paddle:sub_2', 'b@example.com', 'trialing', 0]])

    const transactions = calls.filter(c => c.url.pathname === '/transactions').map(c => c.url.searchParams)
    expect(transactions[0].get('per_page')).toBe('30')
    expect(transactions[0].get('include')).toBe('customer')
    expect(transactions[0].get('updated_at[GTE]')).toBeNull()
    expect(transactions[0].get('status')!.split(',')).not.toContain('draft')
    expect(transactions[0].get('status')!.split(',')).not.toContain('ready')
    expect(transactions[1].get('after')).toBe('txn_2')
    // Refunds are only asked about for what was paid.
    expect(calls.filter(c => c.url.pathname === '/adjustments').map(c => c.url.searchParams.get('transaction_id'))).toEqual(['txn_1', 'txn_3'])
    expect(calls.find(c => c.url.pathname === '/adjustments')!.url.searchParams.get('action')).toBe('refund')
    expect(calls.find(c => c.url.pathname === '/adjustments')!.url.searchParams.get('status')).toBe('approved')
    expect(calls.every(c => c.url.origin === 'https://sandbox-api.paddle.com')).toBe(true)
  })

  test('a later run only asks for what changed since the cursor; "Sync everything" ignores it', async () => {
    const since = 1_700_000_000
    const calls = fakePaddle(account)
    await paddleAdapter.sync(context({ cursor: { since } }).ctx)
    expect(calls.find(c => c.url.pathname === '/transactions')!.url.searchParams.get('updated_at[GTE]')).toBe('2023-11-14T22:13:20Z')

    const again = fakePaddle(account)
    await paddleAdapter.sync(context({ cursor: { since }, reset: true }).ctx)
    expect(again.find(c => c.url.pathname === '/transactions')!.url.searchParams.has('updated_at[GTE]')).toBe(false)
  })

  test('past the deadline it stops after the page it is on and picks up from there', async () => {
    fakePaddle(account)
    const first = context({ deadline: 0 })
    const stopped = await paddleAdapter.sync(first.ctx)
    expect(stopped.done).toBe(false)
    expect(stopped.cursor).toMatchObject({ since: 0, after: 'txn_2' })
    expect(first.saved.payments.length).toBe(2)
    expect(first.saved.subscriptions.length).toBe(0)

    const rest = context({ cursor: stopped.cursor })
    const finished = await paddleAdapter.sync(rest.ctx)
    expect(finished.done).toBe(true)
    expect(rest.saved.payments.map(p => p.stripeId)).toEqual(['paddle:txn_3'])
    expect(rest.saved.subscriptions.length).toBe(2)
  })

  test('Paddle refusing for a minute after some pages is a pause, not a failure; on the first page it is the error', async () => {
    fakePaddle(url => (url.pathname === '/transactions' && url.searchParams.get('after') ? 429 : account(url)))
    const { ctx, saved } = context()
    const paused = await paddleAdapter.sync(ctx)
    expect(paused).toMatchObject({ done: false, cursor: { since: 0, after: 'txn_2' } })
    expect(saved.payments.length).toBe(2)

    fakePaddle(url => (url.pathname === '/transactions' ? 429 : account(url)))
    await expect(paddleAdapter.sync(context().ctx)).rejects.toMatchObject({ statusCode: 502 })
  })
})
