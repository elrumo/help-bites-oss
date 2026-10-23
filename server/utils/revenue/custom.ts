import { createError } from 'h3'
import { STRIPE_STATUSES, monthlyMinor, toMinor } from '#shared/stripe'
import { monthOf, revenuePaymentRow, saveRows, revenueSubscriptionRow, type PaymentRow, type SubscriptionRow } from './rows'

// The custom source: anything HelpBites has no connector for (Google Play's earnings reports, Gumroad,
// PayPal, an invoice you sent by hand) is sent to POST /v1/admin/revenue/payments, as decimals in
// the currency's units, and lands in the same tables as the rest. Sending an id again updates that
// row, so a script can run twice.

const MAX_ROWS = 500
const INTERVALS = ['day', 'week', 'month', 'year']

const bad = (path: string, message: string) => createError({ statusCode: 400, statusMessage: `${path}: ${message}` })
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function amount(path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw bad(path, 'must be a number (19.99, not "19.99" or cents)')
  return value
}

/** An ISO date or an epoch in seconds or milliseconds, as seconds; `fallback` when it is left out. */
function seconds(path: string, value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const ms = typeof value === 'number' ? (value > 1e11 ? value : value * 1000) : Date.parse(String(value))
  if (!Number.isFinite(ms) || ms <= 0) throw bad(path, 'must be an ISO date such as 2026-03-01T10:00:00Z, or epoch seconds')
  return Math.floor(ms / 1000)
}

function list(path: string, value: unknown): Record<string, unknown>[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw bad(path, 'must be an array')
  if (value.length > MAX_ROWS) throw bad(path, `send at most ${MAX_ROWS} at a time`)
  return value.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad(`${path}[${i}]`, 'must be an object')
    return item as Record<string, unknown>
  })
}

/** Validates a request body into rows, or throws a 400 that names the row and the field. */
export function customRows(body: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): { payments: PaymentRow[], subscriptions: SubscriptionRow[] } {
  const payments = list('payments', body.payments).map((p, i) => {
    const at = `payments[${i}]`
    const id = text(p.id, 100)
    const currency = text(p.currency, 10)
    if (!id) throw bad(at, '`id` is required: sending it again updates the payment')
    if (!/^[A-Za-z]{3}$/.test(currency)) throw bad(at, '`currency` must be a three-letter code such as usd')
    return revenuePaymentRow('custom', {
      id, currency, amount: toMinor(amount(`${at}.amount`, p.amount), currency),
      refunded: p.refunded === undefined ? 0 : toMinor(amount(`${at}.refunded`, p.refunded), currency),
      paidAtSec: seconds(`${at}.paidAt`, p.paidAt, nowSec), status: text(p.status, 30) || 'succeeded',
      customerId: text(p.customerId, 100), email: p.email, description: text(p.description, 200), receiptUrl: text(p.receiptUrl, 500)
    })
  })

  const subscriptions = list('subscriptions', body.subscriptions).map((s, i) => {
    const at = `subscriptions[${i}]`
    const id = text(s.id, 100)
    const currency = text(s.currency, 10)
    const interval = text(s.interval, 10)
    const status = text(s.status, 30)
    const count = s.intervalCount === undefined ? 1 : Number(s.intervalCount)
    if (!id) throw bad(at, '`id` is required: sending it again updates the subscription')
    if (!/^[A-Za-z]{3}$/.test(currency)) throw bad(at, '`currency` must be a three-letter code such as usd')
    if (!INTERVALS.includes(interval)) throw bad(at, `\`interval\` must be one of ${INTERVALS.join(', ')}`)
    if (!(STRIPE_STATUSES as readonly string[]).includes(status)) throw bad(at, `\`status\` must be one of ${STRIPE_STATUSES.join(', ')}`)
    if (!Number.isInteger(count) || count < 1 || count > 24) throw bad(at, '`intervalCount` must be a whole number from 1 to 24')
    const price = toMinor(amount(`${at}.amount`, s.amount), currency)
    const startedAtSec = seconds(`${at}.startedAt`, s.startedAt, nowSec)
    const canceledAtSec = seconds(`${at}.canceledAt`, s.canceledAt, 0)
    const stopped = status === 'canceled' || status === 'incomplete_expired'
    // Gone without saying when: it ended when it was cancelled, else now.
    const endedAtSec = seconds(`${at}.endedAt`, s.endedAt, stopped ? canceledAtSec || nowSec : 0)
    return revenueSubscriptionRow('custom', {
      id, currency, status, interval, intervalCount: count, amount: price,
      monthly: monthlyMinor([{ price: { unit_amount: price, recurring: { interval, interval_count: count } } }]),
      plan: text(s.plan, 120), customerId: text(s.customerId, 100), email: s.email, startedAtSec, canceledAtSec,
      paidFromMonth: monthOf(startedAtSec), endedMonth: endedAtSec ? monthOf(endedAtSec) : ''
    })
  })
  if (!payments.length && !subscriptions.length) throw bad('body', 'send `payments` and/or `subscriptions`')
  return { payments, subscriptions }
}

export async function ingestCustom(projectId: string, body: Record<string, unknown>): Promise<{ payments: number, subscriptions: number }> {
  const rows = customRows(body)
  await saveRows('StripePayment', projectId, rows.payments)
  await saveRows('StripeSubscription', projectId, rows.subscriptions)
  return { payments: rows.payments.length, subscriptions: rows.subscriptions.length }
}
