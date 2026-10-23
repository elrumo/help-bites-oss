import { afterEach, describe, expect, test } from 'bun:test'
import { lemonSqueezyAdapter, invoicePayment, orderPayment, periodAmount, subscriptionOf } from '../server/utils/revenue/lemonsqueezy'
import type { PaymentRow, SubscriptionRow } from '../server/utils/revenue/rows'

// Fixtures follow the example responses in https://docs.lemonsqueezy.com/api (orders,
// subscription-invoices, subscriptions, prices). Nothing here has met a real account.

const order = (id: number, attributes: Record<string, unknown> = {}) => ({
  type: 'orders', id: String(id),
  attributes: {
    store_id: 1, customer_id: 1, user_email: 'John.Doe@Example.com', currency: 'USD', total: 1199, status: 'paid', refunded: false, refunded_amount: 0, test_mode: false,
    first_order_item: { product_name: 'Test Limited License for 2 years', variant_name: 'Default', price: 1199, test_mode: false },
    urls: { receipt: 'https://app.lemonsqueezy.com/my-orders/104e18a2?signature=abc' },
    created_at: '2021-08-17T09:45:53.000000Z', updated_at: '2021-08-17T09:45:53.000000Z',
    ...attributes
  }
})

const invoice = (id: number, attributes: Record<string, unknown> = {}) => ({
  type: 'subscription-invoices', id: String(id),
  attributes: {
    store_id: 1, subscription_id: 1, customer_id: 1, user_email: 'john@example.com', billing_reason: 'renewal', currency: 'USD', status: 'paid', refunded: false, refunded_amount: 0,
    total: 999, test_mode: false, urls: { invoice_url: 'https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/y' },
    created_at: '2023-02-18T12:16:24.000000Z', updated_at: '2023-02-18T12:16:24.000000Z',
    ...attributes
  }
})

const subscription = (id: number, attributes: Record<string, unknown> = {}) => ({
  type: 'subscriptions', id: String(id),
  attributes: {
    store_id: 1, customer_id: 1, order_id: 1, product_id: 1, variant_id: 1, product_name: 'Pro', variant_name: 'Monthly', user_email: 'john@example.com',
    status: 'active', cancelled: false, trial_ends_at: null, pause: null,
    first_subscription_item: { id: 1, subscription_id: id, price_id: 1, quantity: 1 },
    renews_at: '2023-03-18T00:00:00.000000Z', ends_at: null, created_at: '2023-01-18T12:16:24.000000Z', updated_at: '2023-02-18T12:16:24.000000Z', test_mode: false,
    ...attributes
  }
})

const monthly = { variant_id: 1, category: 'subscription', scheme: 'standard', unit_price: 999, package_size: 1, tiers: null, renewal_interval_unit: 'month', renewal_interval_quantity: 1 }
const yearly = { ...monthly, variant_id: 2, unit_price: 12000, renewal_interval_unit: 'year' }

describe('orders', () => {
  test('a paid one-time order becomes a succeeded payment in the order currency', () => {
    expect(orderPayment(order(1))).toMatchObject({
      stripeId: 'lemonsqueezy:order-1', source: 'lemonsqueezy', customerId: '1', email: 'john.doe@example.com', status: 'succeeded', currency: 'usd',
      amount: 1199, refunded: 0, net: 1199, paidAtSec: 1_629_193_553, month: '2021-08', description: 'Test Limited License for 2 years', invoiceId: ''
    })
    expect(orderPayment(order(1))!.receiptUrl).toContain('my-orders')
  })

  test('a refunded order stays succeeded and keeps nothing; a partial refund keeps the rest', () => {
    expect(orderPayment(order(2, { status: 'refunded', refunded: true, refunded_amount: 1199 }))).toMatchObject({ status: 'succeeded', amount: 1199, refunded: 1199, net: 0 })
    expect(orderPayment(order(3, { status: 'partial_refund', refunded_amount: 300 }))).toMatchObject({ status: 'succeeded', refunded: 300, net: 899 })
  })

  test('a failed or pending order is kept as it is and adds no revenue', () => {
    expect(orderPayment(order(4, { status: 'failed' }))).toMatchObject({ status: 'failed', net: 0 })
    expect(orderPayment(order(5, { status: 'pending' }))).toMatchObject({ status: 'pending', net: 0 })
  })

  test('test-mode orders and free ones are skipped', () => {
    expect(orderPayment(order(6, { test_mode: true }))).toBeNull()
    expect(orderPayment(order(7, { total: 0 }))).toBeNull()
  })
})

describe('no payment is counted twice', () => {
  test("a subscription's first payment is its order; its initial invoice is skipped, renewals and updates count", () => {
    const first = order(10, { total: 999, first_order_item: { product_name: 'Pro', variant_name: 'Monthly' } })
    const rows = [first, invoice(20, { billing_reason: 'initial' }), invoice(21, { billing_reason: 'renewal' }), invoice(22, { billing_reason: 'updated', total: 250 })]
    const mapped = [orderPayment(rows[0]!), invoicePayment(rows[1]!), invoicePayment(rows[2]!), invoicePayment(rows[3]!)].filter((r): r is PaymentRow => r !== null)
    expect(mapped.map(r => r.stripeId)).toEqual(['lemonsqueezy:order-10', 'lemonsqueezy:invoice-21', 'lemonsqueezy:invoice-22'])
    // Two billing periods plus one plan change, not three periods.
    expect(mapped.reduce((sum, r) => sum + r.net, 0)).toBe(999 + 999 + 250)
    expect(mapped[1]).toMatchObject({ description: 'Subscription renewal', invoiceId: '1', status: 'succeeded' })
  })

  test('an order and an invoice with the same number get different ids', () => {
    expect(orderPayment(order(5))!.stripeId).not.toBe(invoicePayment(invoice(5))!.stripeId)
  })

  test('invoices: refunds, void, test mode', () => {
    expect(invoicePayment(invoice(30, { status: 'partial_refund', refunded_amount: 100 }))).toMatchObject({ status: 'succeeded', refunded: 100, net: 899 })
    expect(invoicePayment(invoice(31, { status: 'refunded' }))).toMatchObject({ refunded: 999, net: 0 })
    expect(invoicePayment(invoice(32, { status: 'void' }))).toMatchObject({ status: 'void', net: 0 })
    expect(invoicePayment(invoice(33, { test_mode: true }))).toBeNull()
  })
})

describe('subscriptions', () => {
  test('an active monthly one counts its price times the seats towards MRR', () => {
    const row = subscriptionOf(subscription(1, { first_subscription_item: { price_id: 1, quantity: 5 } }), monthly, 'USD')!
    expect(row).toMatchObject({
      stripeId: 'lemonsqueezy:1', source: 'lemonsqueezy', status: 'active', plan: 'Pro - Monthly', currency: 'usd', amount: 4995, monthly: 4995, mrr: 4995,
      interval: 'month', intervalCount: 1, cancelAtPeriodEnd: false, endedMonth: '', paidFromMonth: '2023-01', canceledAtSec: 0
    })
    expect(row.currentPeriodEndSec).toBe(Date.parse('2023-03-18T00:00:00Z') / 1000)
  })

  test('an on-trial yearly one is normalised to a month but adds no MRR until the trial ends', () => {
    const trial = subscription(2, { status: 'on_trial', first_subscription_item: null, variant_name: 'Yearly', trial_ends_at: '2023-02-01T00:00:00.000000Z' })
    expect(subscriptionOf(trial, yearly, 'EUR')).toMatchObject({ status: 'trialing', amount: 12000, monthly: 1000, mrr: 0, interval: 'year', plan: 'Pro - Yearly', currency: 'eur', paidFromMonth: '2023-02' })
  })

  test('a cancelled one on its grace period is canceled, ends in its last paid month and cancels at period end', () => {
    const grace = subscription(3, { status: 'cancelled', cancelled: true, ends_at: '2023-04-18T00:00:00.000000Z', updated_at: '2023-03-01T10:00:00.000000Z' })
    expect(subscriptionOf(grace, monthly, 'USD')).toMatchObject({ status: 'canceled', mrr: 0, monthly: 999, cancelAtPeriodEnd: true, endedMonth: '2023-04', canceledAtSec: Date.parse('2023-03-01T10:00:00Z') / 1000 })
  })

  test('an expired one is canceled and no longer scheduled to cancel', () => {
    const gone = subscription(4, { status: 'expired', cancelled: true, ends_at: '2023-05-02T00:00:00.000000Z' })
    expect(subscriptionOf(gone, monthly, 'USD')).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: false, endedMonth: '2023-05', mrr: 0 })
  })

  test('the other statuses keep their names; only active and past_due earn MRR', () => {
    const statuses = ['active', 'paused', 'past_due', 'unpaid'].map(status => subscriptionOf(subscription(5, { status }), monthly, 'USD')!)
    expect(statuses.map(s => s.status)).toEqual(['active', 'paused', 'past_due', 'unpaid'])
    expect(statuses.map(s => s.mrr)).toEqual([999, 0, 999, 0])
  })

  test('test mode is skipped; a missing or tiered price counts nothing instead of guessing', () => {
    expect(subscriptionOf(subscription(6, { test_mode: true }), monthly, 'USD')).toBeNull()
    expect(subscriptionOf(subscription(7), null, 'USD')).toMatchObject({ amount: 0, monthly: 0, mrr: 0, interval: '' })
    expect(subscriptionOf(subscription(8), { ...monthly, scheme: 'graduated', unit_price: null }, 'USD')).toMatchObject({ amount: 0, mrr: 0 })
  })

  test('package pricing rounds the seats up to whole packages', () => {
    expect(periodAmount({ scheme: 'package', unit_price: 500, package_size: 10 }, 25)).toBe(1500)
    expect(periodAmount({ scheme: 'standard', unit_price: 500 }, 0)).toBe(0)
  })
})

// A fake Lemon Squeezy: routes the adapter's requests to canned JSON:API pages.
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

type Route = (url: URL) => { status?: number, body: unknown } | undefined
function fakeApi(route: Route) {
  const seen: string[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer KEY_KEY_KEY_KEY_KEY_KEY')
    expect((init?.headers as Record<string, string>).accept).toBe('application/vnd.api+json')
    seen.push(`${url.pathname}?${[...url.searchParams].filter(([k]) => k !== 'page[size]').map(([k, v]) => `${k}=${v}`).join('&')}`)
    const hit = route(url) ?? { status: 404, body: { errors: [{ status: '404', title: 'Not Found', detail: `no route for ${url.pathname}` }] } }
    return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 })
  }) as typeof fetch
  return seen
}

const list = (data: unknown[], page: number, lastPage: number) => ({ meta: { page: { currentPage: page, lastPage, perPage: 100, total: data.length } }, data })
const credentials = { apiKey: 'KEY_KEY_KEY_KEY_KEY_KEY' }

function context(over: Partial<Parameters<typeof lemonSqueezyAdapter.sync>[0]> = {}) {
  const payments: PaymentRow[] = []
  const subscriptions: SubscriptionRow[] = []
  const ctx = {
    credentials, cursor: {}, reset: false, deadline: Date.now() + 60_000,
    savePayments: async (rows: PaymentRow[]) => { payments.push(...rows) },
    saveSubscriptions: async (rows: SubscriptionRow[]) => { subscriptions.push(...rows) },
    ...over
  }
  return { ctx, payments, subscriptions }
}

const store = { type: 'stores', id: '1', attributes: { name: 'Acme Store', currency: 'EUR' } }

describe('check', () => {
  test('rejects a key that cannot be one before calling the API', async () => {
    const seen = fakeApi(() => undefined)
    for (const apiKey of ['', '   ', 'short', 'has spaces in it and is long enough to pass the length']) {
      await expect(lemonSqueezyAdapter.check({ apiKey })).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(seen).toEqual([])
  })

  test('names the account by its stores and reads the key mode from /users/me', async () => {
    const seen = fakeApi(url => url.pathname === '/v1/users/me' ? { body: { meta: { test_mode: false }, data: { type: 'users', id: '1', attributes: { name: 'John Doe' } } } } : url.pathname === '/v1/stores' ? { body: list([store, { ...store, id: '2', attributes: { name: 'Second' } }], 1, 1) } : undefined)
    expect(await lemonSqueezyAdapter.check(credentials)).toEqual({ accountName: 'Acme Store, Second', livemode: true })
    expect(seen[0]).toBe('/v1/users/me?')

    fakeApi(url => url.pathname === '/v1/users/me' ? { body: { meta: { test_mode: true }, data: { attributes: { name: 'John Doe' } } } } : { body: list([], 1, 1) })
    expect(await lemonSqueezyAdapter.check(credentials)).toEqual({ accountName: 'John Doe', livemode: false })
  })

  test('a key the API refuses is a 502 with its reason', async () => {
    fakeApi(() => ({ status: 401, body: { errors: [{ status: '401', title: 'Unauthenticated.', detail: 'Unauthenticated.' }] } }))
    await expect(lemonSqueezyAdapter.check(credentials)).rejects.toMatchObject({ statusCode: 502, statusMessage: 'Lemon Squeezy answered 401: Unauthenticated.' })
  })
})

describe('sync', () => {
  const routes = (url: URL) => {
    const page = Number(url.searchParams.get('page[number]') || 1)
    switch (url.pathname) {
      case '/v1/orders': return { body: list(page === 1 ? [order(11, { created_at: '2023-02-20T00:00:00Z' }), order(12, { test_mode: true })] : [order(13, { created_at: '2023-01-20T00:00:00Z' })], page, 2) }
      case '/v1/subscription-invoices': return { body: list([invoice(21, { billing_reason: 'initial' }), invoice(22)], 1, 1) }
      case '/v1/subscriptions': return { body: list([subscription(31), subscription(32, { status: 'on_trial', first_subscription_item: null, variant_id: 2, trial_ends_at: '2023-03-01T00:00:00Z' })], 1, 1) }
      case '/v1/stores': return { body: list([store], 1, 1) }
      case '/v1/prices/1': return { body: { data: { type: 'prices', id: '1', attributes: monthly } } }
      case '/v1/prices': return url.searchParams.get('filter[variant_id]') === '2' ? { body: list([{ type: 'prices', id: '9', attributes: yearly }], 1, 1) } : undefined
    }
  }

  test('the first run reads every page of orders, the invoices and every subscription, and is done', async () => {
    const seen = fakeApi(routes)
    const { ctx, payments, subscriptions } = context()
    const startedAt = Math.floor(Date.now() / 1000)
    const result = await lemonSqueezyAdapter.sync(ctx)
    expect(result.done).toBe(true)
    expect(result.cursor.since).toBeGreaterThanOrEqual(startedAt)
    expect(payments.map(p => p.stripeId)).toEqual(['lemonsqueezy:order-11', 'lemonsqueezy:order-13', 'lemonsqueezy:invoice-22'])
    expect(subscriptions.map(s => [s.stripeId, s.status, s.mrr, s.currency, s.amount])).toEqual([['lemonsqueezy:31', 'active', 999, 'eur', 999], ['lemonsqueezy:32', 'trialing', 0, 'eur', 12000]])
    // The trial has no subscription item, so its price came from its variant; prices and stores are fetched once.
    expect(seen.filter(s => s.startsWith('/v1/prices')).sort()).toEqual(['/v1/prices/1?', '/v1/prices?filter[variant_id]=2'])
    expect(seen.filter(s => s.startsWith('/v1/stores'))).toHaveLength(1)
  })

  test('the deadline stops it after a page, and the cursor picks up at the next one', async () => {
    const seen = fakeApi(routes)
    const first = context({ deadline: 0 })
    const paused = await lemonSqueezyAdapter.sync(first.ctx)
    expect(paused).toEqual({ cursor: { since: undefined, startedAt: expect.any(Number), phase: 'orders', page: 2 }, done: false })
    expect(first.payments.map(p => p.stripeId)).toEqual(['lemonsqueezy:order-11'])

    const second = context({ cursor: paused.cursor })
    const rest = await lemonSqueezyAdapter.sync(second.ctx)
    expect(rest.done).toBe(true)
    expect(rest.cursor.since).toBe(paused.cursor.startedAt as number)
    expect(second.payments.map(p => p.stripeId)).toEqual(['lemonsqueezy:order-13', 'lemonsqueezy:invoice-22'])
    expect(seen.filter(s => s.startsWith('/v1/orders'))).toEqual(['/v1/orders?page[number]=1', '/v1/orders?page[number]=2'])
  })

  test('a later run stops at the first page that reaches back 35 days before the last run', async () => {
    const since = Date.parse('2023-03-01T00:00:00Z') / 1000
    const seen = fakeApi(url => url.pathname === '/v1/orders'
      ? { body: list([order(40, { created_at: '2023-02-27T00:00:00Z' }), order(41, { created_at: '2022-12-01T00:00:00Z' })], 1, 9) }
      : routes(url))
    const { ctx, payments } = context({ cursor: { since } })
    expect((await lemonSqueezyAdapter.sync(ctx)).done).toBe(true)
    // Page 2 of 9 is never asked for; the page that reached the window is still saved (rows are upserted).
    expect(seen.filter(s => s.startsWith('/v1/orders'))).toEqual(['/v1/orders?page[number]=1'])
    expect(payments.map(p => p.stripeId)).toContain('lemonsqueezy:order-40')
  })

  test('"Sync everything" ignores the cursor', async () => {
    const seen = fakeApi(routes)
    const { ctx } = context({ cursor: { since: Math.floor(Date.now() / 1000), phase: 'subscriptions', page: 7 }, reset: true })
    await lemonSqueezyAdapter.sync(ctx)
    expect(seen.filter(s => s.startsWith('/v1/orders'))).toHaveLength(2)
  })

  test('an error from the API is not swallowed into zero-priced subscriptions', async () => {
    fakeApi(url => url.pathname.startsWith('/v1/prices') ? { status: 429, body: { errors: [{ title: 'Too Many Requests' }] } } : routes(url))
    const { ctx } = context({ cursor: { phase: 'subscriptions' } })
    await expect(lemonSqueezyAdapter.sync(ctx)).rejects.toMatchObject({ statusCode: 502, statusMessage: 'Lemon Squeezy answered 429: Too Many Requests' })
  })

  test('a deleted price (404) leaves the subscription with no value rather than failing the run', async () => {
    fakeApi(url => url.pathname === '/v1/prices/1' ? { status: 404, body: { errors: [{ detail: 'Not Found' }] } } : routes(url))
    const { ctx, subscriptions } = context({ cursor: { phase: 'subscriptions' } })
    expect((await lemonSqueezyAdapter.sync(ctx)).done).toBe(true)
    expect(subscriptions[0]).toMatchObject({ stripeId: 'lemonsqueezy:31', amount: 0, mrr: 0 })
  })
})
