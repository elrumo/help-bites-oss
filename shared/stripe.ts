// Stripe data in HelpBites: payments and subscriptions are synced from the
// developer's Stripe account (server/utils/stripe.ts), and a short summary of
// each customer is written onto their contact as `stripe_*` attributes — so
// segments, the People filters and campaigns can use it like any attribute.
// Shared by the server and the panel.

import type { SegmentRule } from './segments'

export const STRIPE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', 'canceled', 'incomplete_expired'] as const
export type StripeSubscriptionStatus = typeof STRIPE_STATUSES[number]

/** The attribute keys a sync writes on a contact. */
export const STRIPE_ATTR = {
  customer: 'stripe_customer',
  revenue: 'stripe_revenue',
  payments: 'stripe_payments',
  lastPayment: 'stripe_last_payment',
  mrr: 'stripe_mrr',
  status: 'stripe_status',
  plan: 'stripe_plan'
} as const

export type StripeConnection = {
  connected: boolean
  accountName: string
  /** The currency totals are shown in: the one with the most revenue. Others are left out of totals. */
  currency: string
  livemode: boolean
  status: 'idle' | 'running' | 'error'
  lastRunAt: string | null
  lastError: string
  stats: { payments: number, subscriptions: number, contacts: number }
}

/** A Stripe customer as read live; `balance` is in the smallest unit of `currency`, negative when they have credit. */
export type StripeCustomerDto = { id: string, name: string, email: string, createdAt: string | null, country: string, delinquent: boolean, balance: number, currency: string, livemode: boolean }
/** `contactId` is the person in HelpBites this belongs to ('' when nobody matches); added by the revenue report so a row can open them. */
export type StripePaymentDto = { id: string, customerId: string, contactId?: string, email: string, amount: number, refunded: number, currency: string, status: string, description: string, receiptUrl: string, paidAt: string }
export type StripeSubscriptionDto = { id: string, customerId: string, email: string, status: StripeSubscriptionStatus, plan: string, mrr: number, amount: number, interval: string, intervalCount: number, currency: string, startedAt: string | null, canceledAt: string | null, currentPeriodEnd: string | null, cancelAtPeriodEnd: boolean }

export type RevenueRange = '30d' | '90d' | '12m' | 'all'
export const REVENUE_RANGES: { value: RevenueRange, label: string, days: number }[] = [
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: '12m', label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All time', days: 0 }
]

export type RevenueReport = {
  currency: string
  range: RevenueRange
  net: number
  gross: number
  refunds: number
  payments: number
  customers: number
  allTimeNet: number
  mrr: number
  arr: number
  subscribers: { active: number, trialing: number, pastDue: number }
  newSubscribers: number
  churned: number
  /** `mrr` is the MRR at the end of the month (this month: today). */
  months: { month: string, net: number, payments: number, mrr: number }[]
  plans: { plan: string, subscribers: number, mrr: number }[]
  topCustomers: { customerId: string, contactId: string, email: string, net: number, payments: number }[]
  recent: StripePaymentDto[]
  otherCurrencies: { currency: string, net: number }[]
}

// Stripe amounts are in the currency's smallest unit; these have no cents.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

/** Stripe's smallest-unit amount as a number of the currency's units (1999 usd → 19.99). */
export function fromMinor(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : Math.round(amount) / 100
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

type PriceLike = { unit_amount?: number | null, recurring?: { interval?: string, interval_count?: number } | null }
type ItemLike = { quantity?: number | null, price?: PriceLike | null }

/** What one subscription adds to monthly recurring revenue, in the smallest currency unit. */
export function monthlyMinor(items: ItemLike[]): number {
  let total = 0
  for (const item of items) {
    const amount = (item.price?.unit_amount || 0) * (item.quantity ?? 1)
    const every = Math.max(1, item.price?.recurring?.interval_count || 1)
    const perMonth = { day: 30, week: 52 / 12, month: 1, year: 1 / 12 }[item.price?.recurring?.interval || ''] ?? 0
    // ponytail: list prices only; coupons and metered usage are not reflected.
    total += (amount * perMonth) / every
  }
  return Math.round(total)
}

const RANK = Object.fromEntries(STRIPE_STATUSES.map((status, index) => [status, index])) as Record<string, number>

/** Statuses whose subscribers pay today. */
export const PAYING_STATUSES: StripeSubscriptionStatus[] = ['active', 'past_due']

type RollupSub = { status: string, plan: string, mrr: number }

/** One customer's summary as contact attributes; `null` removes a key that no longer applies. */
export function rollupAttributes(customerId: string, payments: { net: number, count: number, lastAt: number | null }, subs: RollupSub[], currency: string): Record<string, string | number | null> {
  const best = [...subs].sort((a, b) => (RANK[a.status] ?? 99) - (RANK[b.status] ?? 99))[0]
  const mrr = subs.filter(s => PAYING_STATUSES.includes(s.status as StripeSubscriptionStatus)).reduce((sum, s) => sum + s.mrr, 0)
  return {
    [STRIPE_ATTR.customer]: customerId,
    // Nothing kept net counts as never having paid, so "Never paid" is simply "no revenue attribute".
    [STRIPE_ATTR.revenue]: payments.net > 0 ? fromMinor(payments.net, currency) : null,
    [STRIPE_ATTR.payments]: payments.net > 0 ? payments.count : null,
    [STRIPE_ATTR.lastPayment]: payments.lastAt ? new Date(payments.lastAt * 1000).toISOString() : null,
    [STRIPE_ATTR.mrr]: fromMinor(mrr, currency),
    [STRIPE_ATTR.status]: best?.status || 'none',
    [STRIPE_ATTR.plan]: best?.plan || null
  }
}

export const BILLING_FILTERS = [
  { value: 'all', label: 'Any billing' },
  { value: 'paying', label: 'Has paid' },
  { value: 'never', label: 'Never paid' },
  { value: 'active', label: 'Subscribed' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'past_due', label: 'Past due' },
  { value: 'canceled', label: 'Canceled' }
] as const

/** The People filters (billing status, minimum spend) as segment rules. Unknown values add nothing. */
export function billingRules(billing: string, minRevenue?: number): SegmentRule[] {
  const attr = (key: string) => `attributes.${key}`
  const rules: SegmentRule[] = []
  if (billing === 'paying') rules.push({ field: attr(STRIPE_ATTR.revenue), op: 'gt', value: 0 })
  else if (billing === 'never') rules.push({ field: attr(STRIPE_ATTR.revenue), op: 'not_exists' })
  else if (['active', 'trialing', 'past_due', 'canceled'].includes(billing)) rules.push({ field: attr(STRIPE_ATTR.status), op: 'is', value: billing })
  if (minRevenue !== undefined && Number.isFinite(minRevenue) && minRevenue > 0) rules.push({ field: attr(STRIPE_ATTR.revenue), op: 'gt', value: minRevenue })
  return rules
}
