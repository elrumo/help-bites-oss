import { createError } from 'h3'
import { monthlyMinor } from '#shared/stripe'
import { monthOf, revenuePaymentRow, revenueSubscriptionRow, type PaymentRow, type SubscriptionRow } from './rows'
import type { PullAdapter } from './types'

// Lemon Squeezy, read only (https://docs.lemonsqueezy.com/api). The API key is the
// seller's own; it sees every store of the account, so no store ids are asked for.
// Lists come newest first, 100 a page, and the API allows 300 calls a minute.
//
// Payments, each counted once. A subscription's first payment is an order AND an
// invoice (`order_created` always comes with `subscription_created`, and the invoice's
// `billing_reason` is `initial`); its renewals and plan changes are invoices only. So:
//   /orders                 every order, which includes every subscription's first payment
//   /subscription-invoices  every invoice except `initial` (`renewal`, `updated`)
// Order and invoice ids are different number spaces, hence the `order-` / `invoice-` prefix.
//
// A run reads orders, then invoices, then every subscription. The lists have no date
// filter, so a later run reads from the newest and stops at the first page that
// reaches REFRESH_DAYS before the last run: that is how refunds on recent payments are
// picked up. "Sync everything" starts over.

const API = 'https://api.lemonsqueezy.com/v1'
const REFRESH_DAYS = 35
const DAY = 86_400

type Resource = { id: string | number, attributes: Record<string, any> }
type Phase = 'orders' | 'invoices' | 'subscriptions'
const PHASES: Phase[] = ['orders', 'invoices', 'subscriptions']
const PATHS: Record<Phase, string> = { orders: '/orders', invoices: '/subscription-invoices', subscriptions: '/subscriptions' }
type Cursor = { since?: number, startedAt?: number, phase?: Phase, page?: number }

async function get(key: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' },
    signal: AbortSignal.timeout(30_000)
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const why = body?.errors?.[0]
    throw createError({ statusCode: 502, statusMessage: `Lemon Squeezy answered ${res.status}: ${String(why?.detail || why?.title || res.statusText).slice(0, 200)}`, data: { status: res.status } })
  }
  return body
}

/** The pages of a list from `from`, newest first; `last` is true on the final one (`meta.page.lastPage`). */
async function* pages(key: string, path: string, from = 1): AsyncGenerator<{ data: Resource[], page: number, last: boolean }> {
  for (let page = from; ; page++) {
    const body = await get(key, path, { 'page[number]': String(page), 'page[size]': '100' })
    const data = (body.data || []) as Resource[]
    const last = !data.length || page >= (Number(body.meta?.page?.lastPage) || 1)
    yield { data, page, last }
    if (last) return
  }
}

// ---- mapping -------------------------------------------------------------------

/** Epoch seconds of one of Lemon Squeezy's ISO timestamps; 0 when absent. */
const sec = (value: unknown) => Math.floor(Date.parse(String(value ?? '')) / 1000) || 0

/** "Pro - Monthly"; a variant left at Lemon Squeezy's "Default" adds nothing. */
const nameOf = (product: unknown, variant: unknown) =>
  [product, variant].map(p => String(p || '').trim()).filter(p => p && p.toLowerCase() !== 'default').join(' - ')

type PaymentExtra = { description: string, receiptUrl: string, invoiceId?: string }

// Amounts are cents in the record's own `currency`. `total` is what the customer paid, tax
// included, as Stripe's charge amount is. A refunded or partly refunded payment did succeed:
// like a Stripe charge it stays `succeeded` and carries `refunded`, so the reports net it.
// Test-mode records are not revenue, and a $0 order (a free product, a trial start) is not a payment.
function paymentOf(id: string, a: Record<string, any>, extra: PaymentExtra): PaymentRow | null {
  const total = Number(a.total) || 0
  if (a.test_mode === true || total <= 0) return null
  return revenuePaymentRow('lemonsqueezy', {
    id, customerId: String(a.customer_id || ''), email: a.user_email, amount: total, currency: String(a.currency || ''), paidAtSec: sec(a.created_at),
    status: ['paid', 'refunded', 'partial_refund'].includes(a.status) ? 'succeeded' : String(a.status || 'unknown'),
    refunded: a.status === 'refunded' ? total : Number(a.refunded_amount) || 0,
    ...extra
  })
}

export function orderPayment(r: Resource): PaymentRow | null {
  const a = r.attributes
  return paymentOf(`order-${r.id}`, a, { description: nameOf(a.first_order_item?.product_name, a.first_order_item?.variant_name), receiptUrl: a.urls?.receipt || '' })
}

/** `null` for an `initial` invoice: that payment is already the subscription's order. */
export function invoicePayment(r: Resource): PaymentRow | null {
  const a = r.attributes
  if (a.billing_reason === 'initial') return null
  return paymentOf(`invoice-${r.id}`, a, { description: `Subscription ${a.billing_reason === 'updated' ? 'update' : 'renewal'}`, receiptUrl: a.urls?.invoice_url || '', invoiceId: String(a.subscription_id || '') })
}

/** What one billing period costs, in cents: the list price times the seats. */
// ponytail: graduated, volume and usage-based prices (no plain `unit_price`) count 0; their tiers are not replayed. Discounts are not reflected.
export function periodAmount(price: Record<string, any> | null, quantity: number): number {
  const unit = Number(price?.unit_price) || 0
  if (price?.scheme === 'package') return Math.ceil(quantity / Math.max(1, Number(price.package_size) || 1)) * unit
  return price?.scheme === 'standard' ? unit * quantity : 0
}

const STATUS: Record<string, string> = { on_trial: 'trialing', cancelled: 'canceled', expired: 'canceled' }

/**
 * `price` is the subscription's price object and `currency` its store's: Lemon Squeezy puts neither
 * the price nor the interval on the subscription itself.
 */
export function subscriptionOf(r: Resource, price: Record<string, any> | null, currency: string): SubscriptionRow | null {
  const a = r.attributes
  if (a.test_mode === true) return null
  const amount = periodAmount(price, Number(a.first_subscription_item?.quantity ?? 1))
  const interval = String(price?.renewal_interval_unit || '')
  const every = Number(price?.renewal_interval_quantity) || 1
  // `cancelled` is a grace period that runs to `ends_at`; `expired` has run out. Neither pays any more.
  const ended = a.status === 'cancelled' || a.status === 'expired'
  const endsAt = sec(a.ends_at) || sec(a.updated_at)
  return revenueSubscriptionRow('lemonsqueezy', {
    id: String(r.id), customerId: String(a.customer_id || ''), email: a.user_email,
    status: STATUS[a.status] ?? String(a.status || ''),
    plan: nameOf(a.product_name, a.variant_name), currency, amount, interval, intervalCount: every,
    monthly: monthlyMinor([{ price: { unit_amount: amount, recurring: { interval, interval_count: every } } }]),
    startedAtSec: sec(a.created_at),
    // ponytail: there is no cancelled_at, so `updated_at` (when it last changed) stands in for it.
    canceledAtSec: ended ? sec(a.updated_at) : 0,
    currentPeriodEndSec: sec(a.renews_at),
    cancelAtPeriodEnd: a.cancelled === true && a.status !== 'expired',
    // ponytail: `trial_ends_at` is only set while on_trial, so a subscription whose trial is over counts from its creation.
    paidFromMonth: monthOf(Math.max(sec(a.created_at), sec(a.trial_ends_at))),
    endedMonth: ended ? monthOf(endsAt) : ''
  })
}

// ---- syncing -------------------------------------------------------------------

/** The prices and store currencies the subscriptions of one run need, each fetched once. */
function lookups(key: string) {
  const prices = new Map<string, Record<string, any> | null>()
  let currencies: Map<string, string> | undefined
  return {
    async currency(storeId: unknown): Promise<string> {
      if (!currencies) {
        currencies = new Map()
        for await (const page of pages(key, '/stores')) for (const s of page.data) currencies.set(String(s.id), String(s.attributes.currency || ''))
      }
      return currencies.get(String(storeId)) || ''
    },
    /** The price the subscription pays (its item's); during a free trial there is no item, so the variant's newest price. */
    async price(a: Record<string, any>): Promise<Record<string, any> | null> {
      const id = a.first_subscription_item?.price_id
      const slot = id ? `price:${id}` : `variant:${a.variant_id}`
      if (!prices.has(slot)) {
        try {
          const body = id ? await get(key, `/prices/${id}`) : await get(key, '/prices', { 'filter[variant_id]': String(a.variant_id) })
          prices.set(slot, (id ? body.data : body.data?.[0])?.attributes ?? null)
        } catch (error) {
          // A price that was deleted leaves a subscription we can name but not value; anything else (a rate limit) must not write zeros.
          if ((error as { data?: { status?: number } }).data?.status !== 404) throw error
          prices.set(slot, null)
        }
      }
      return prices.get(slot) ?? null
    }
  }
}

export const lemonSqueezyAdapter: PullAdapter = {
  id: 'lemonsqueezy',

  async check(credentials) {
    const key = (credentials.apiKey || '').trim()
    if (!/^[\w.~+/=-]{20,}$/.test(key)) throw createError({ statusCode: 400, statusMessage: 'Paste a Lemon Squeezy API key (Settings, API)' })
    const me = await get(key, '/users/me')
    const stores = await get(key, '/stores')
    const names = ((stores.data || []) as Resource[]).map(s => String(s.attributes.name || '')).filter(Boolean).slice(0, 3).join(', ')
    // `meta.test_mode` says which mode the key was made in; a test key reads test data only, which is never synced.
    return { accountName: names || String(me.data?.attributes?.name || 'Lemon Squeezy'), livemode: me.meta?.test_mode !== true }
  },

  async sync(ctx) {
    const key = (ctx.credentials.apiKey || '').trim()
    const c: Cursor = ctx.reset ? {} : ctx.cursor
    const startedAt = c.startedAt ?? Math.floor(Date.now() / 1000)
    // Payments older than this were read by an earlier complete run (never, on the first).
    const floor = c.since ? c.since - REFRESH_DAYS * DAY : 0
    const lookup = lookups(key)
    const resume = c.phase ?? 'orders'

    for (const phase of PHASES.slice(PHASES.indexOf(resume))) {
      for await (const { data, page, last } of pages(key, PATHS[phase], phase === resume ? c.page ?? 1 : 1)) {
        if (phase === 'subscriptions') {
          const rows: SubscriptionRow[] = []
          for (const r of data) {
            const row = subscriptionOf(r, await lookup.price(r.attributes), await lookup.currency(r.attributes.store_id))
            if (row) rows.push(row)
          }
          if (rows.length) await ctx.saveSubscriptions(rows)
        } else {
          const rows = data.map(phase === 'orders' ? orderPayment : invoicePayment).filter((row): row is PaymentRow => row !== null)
          if (rows.length) await ctx.savePayments(rows)
        }
        // Newest first: a page that reaches back past the floor is the last one worth reading.
        const reached = phase !== 'subscriptions' && floor > 0 && data.length > 0 && sec(data.at(-1)!.attributes.created_at) < floor
        if (last || reached) break
        if (Date.now() > ctx.deadline) return { cursor: { since: c.since, startedAt, phase, page: page + 1 }, done: false }
      }
    }
    return { cursor: { since: startedAt }, done: true }
  }
}
