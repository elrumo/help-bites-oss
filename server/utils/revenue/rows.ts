import { normalizeEmail } from '#shared/contacts'
import { rowKey, type RevenueSourceId } from '#shared/revenue'
import { PAYING_STATUSES, STRIPE_STATUSES, type StripeSubscriptionStatus } from '#shared/stripe'
import { MASTER, useParse, type ParseObject } from '../parse'

// The rows every revenue source writes (the StripePayment and StripeSubscription
// classes): amounts in the currency's smallest unit, `month` as YYYY-MM (UTC),
// ids prefixed with the source so two sources never meet (shared/revenue.ts).

export type PaymentRow = {
  stripeId: string
  source: RevenueSourceId
  customerId: string
  email: string
  status: string
  currency: string
  amount: number
  refunded: number
  /** What stayed: 0 unless the payment succeeded. The reports sum this. */
  net: number
  paidAtSec: number
  month: string
  description: string
  receiptUrl: string
  invoiceId: string
}

export type SubscriptionRow = {
  stripeId: string
  source: RevenueSourceId
  customerId: string
  email: string
  status: StripeSubscriptionStatus
  plan: string
  currency: string
  amount: number
  interval: string
  intervalCount: number
  /** Monthly recurring revenue; 0 unless it pays today. */
  mrr: number
  startedAtSec: number
  canceledAtSec: number
  currentPeriodEndSec: number
  cancelAtPeriodEnd: boolean
  /** Its price a month, paid from `paidFromMonth` until `endedMonth` ('' while it runs): the Revenue chart's MRR by month. */
  monthly: number
  paidFromMonth: string
  endedMonth: string
  /** The newest event applied (a push source): an event that arrives late is ignored. */
  eventAtSec: number
}

export const monthOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 7)

export type PaymentInput = {
  id: string
  customerId?: string
  email?: unknown
  amount: number
  currency: string
  paidAtSec: number
  /** `succeeded` (the default) counts towards revenue. */
  status?: string
  refunded?: number
  description?: string
  receiptUrl?: string
  invoiceId?: string
}

/** A payment as the reports read it; a refunded or failed one keeps nothing (`net`). */
export function revenuePaymentRow(source: RevenueSourceId, p: PaymentInput): PaymentRow {
  const status = p.status || 'succeeded'
  // Negative only for a source that reports refunds as their own (negative) line, such as Apple's sales reports.
  const amount = Math.round(p.amount) || 0
  const refunded = Math.min(Math.max(amount, 0), Math.max(0, Math.round(p.refunded || 0)))
  return {
    stripeId: rowKey(source, p.id), source, customerId: p.customerId || '', email: normalizeEmail(p.email), status,
    currency: p.currency.toLowerCase(), amount, refunded, net: status === 'succeeded' ? amount - refunded : 0,
    paidAtSec: p.paidAtSec, month: monthOf(p.paidAtSec), description: (p.description || '').slice(0, 200),
    receiptUrl: p.receiptUrl || '', invoiceId: p.invoiceId || ''
  }
}

export type SubscriptionInput = {
  id: string
  customerId?: string
  email?: unknown
  status: string
  plan: string
  currency: string
  /** Per period, and `monthly` the same normalised to a month (both smallest units). */
  amount: number
  monthly: number
  interval: string
  intervalCount?: number
  startedAtSec: number
  canceledAtSec?: number
  currentPeriodEndSec?: number
  cancelAtPeriodEnd?: boolean
  /** When it started to pay (after a trial) and when it ended; '' while it runs. */
  paidFromMonth?: string
  endedMonth?: string
  eventAtSec?: number
}

export function revenueSubscriptionRow(source: RevenueSourceId, s: SubscriptionInput): SubscriptionRow {
  const status = (STRIPE_STATUSES as readonly string[]).includes(s.status) ? s.status as StripeSubscriptionStatus : 'incomplete'
  return {
    stripeId: rowKey(source, s.id), source, customerId: s.customerId || '', email: normalizeEmail(s.email), status,
    plan: s.plan.slice(0, 120) || 'Subscription', currency: s.currency.toLowerCase(), amount: Math.round(s.amount) || 0,
    interval: s.interval, intervalCount: s.intervalCount || 1,
    // Counted once it pays: a trial or a lapsed subscription is not recurring revenue yet.
    mrr: PAYING_STATUSES.includes(status) ? Math.round(s.monthly) || 0 : 0,
    startedAtSec: s.startedAtSec, canceledAtSec: s.canceledAtSec || 0, currentPeriodEndSec: s.currentPeriodEndSec || 0,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd === true, monthly: Math.round(s.monthly) || 0,
    paidFromMonth: s.paidFromMonth ?? monthOf(s.startedAtSec), endedMonth: s.endedMonth || '', eventAtSec: s.eventAtSec || 0
  }
}

/** Creates or updates rows of a class by their `stripeId`, in one project. */
export async function saveRows(className: 'StripePayment' | 'StripeSubscription', projectId: string, items: (Record<string, unknown> & { stripeId: string })[]) {
  if (!items.length) return
  const Parse = useParse()
  const project = Parse.Object.extend('Project').createWithoutData(projectId)
  // The same id twice in one batch is one row (the last wins), not two.
  const unique = [...new Map(items.map(item => [item.stripeId, item])).values()]
  const existing = await new Parse.Query(className).equalTo('projectId', projectId).containedIn('stripeId', unique.map(i => i.stripeId)).limit(unique.length).find(MASTER)
  const byId = new Map(existing.map(row => [String(row.get('stripeId')), row]))
  const rows = unique.map((item) => {
    const row = byId.get(item.stripeId) || new (Parse.Object.extend(className))() as ParseObject
    row.set({ ...item, project, projectId })
    return row
  })
  await Parse.Object.saveAll(rows, { ...MASTER, batchSize: 50 })
}
