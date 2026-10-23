import { createError } from 'h3'
import { normalizeEmail } from '#shared/contacts'
import { rowKey } from '#shared/revenue'
import { toMinor } from '#shared/stripe'
import { MASTER, useParse, type ParseObject } from '../parse'
import { runExclusive } from '../redis'
import { monthOf, revenuePaymentRow, saveRows, revenueSubscriptionRow, type PaymentRow, type SubscriptionInput, type SubscriptionRow } from './rows'

// RevenueCat pushes: its webhook (Project settings → Integrations → Webhooks) posts one event per
// purchase, renewal, cancellation, expiry or refund to /v1/webhooks/revenuecat/<project>, with the
// secret HelpBites made in its Authorization header. Each event is turned into payment and
// subscription rows, so the Revenue tab keeps up in real time. RevenueCat cannot replay old events:
// history starts when the webhook does, and what happened before is missing (the custom API can
// fill it in). Amounts are RevenueCat's USD `price` (what the customer paid, before the store's
// commission and tax), whatever currency they paid in; sandbox purchases are not revenue and are
// ignored.

const SOURCE = 'revenuecat'
const MONTH_SEC = 30.4375 * 86_400
// Real periods drift by a day or two; these are the lengths stores sell.
const USUAL_MONTHS = [(7 * 86_400) / MONTH_SEC, 1, 2, 3, 6, 12]
const STORES: Record<string, string> = { APP_STORE: 'App Store', MAC_APP_STORE: 'Mac App Store', PLAY_STORE: 'Google Play', AMAZON: 'Amazon', STRIPE: 'Stripe', RC_BILLING: 'RevenueCat Billing', PADDLE: 'Paddle', ROKU: 'Roku' }
const PURCHASES = ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']
const SUBSCRIPTION_EVENTS = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'CANCELLATION', 'UNCANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'SUBSCRIPTION_EXTENDED', 'EXPIRATION']

/** A period's length in months, snapped to a week, 1, 2, 3, 6 or 12 months when it is within 10% of one. */
export function periodMonths(seconds: number): number {
  if (!(seconds > 0)) return 0
  const months = seconds / MONTH_SEC
  return USUAL_MONTHS.find(m => Math.abs(months - m) / m < 0.1) ?? months
}

function intervalOf(months: number): { interval: string, intervalCount: number } {
  if (months < 0.5) return { interval: 'week', intervalCount: 1 }
  if (months === 12) return { interval: 'year', intervalCount: 1 }
  return { interval: 'month', intervalCount: Math.max(1, Math.round(months)) }
}

/** Who bought: the app's own user id when RevenueCat knows one (it is the contact's external id), else its anonymous id. */
function customerOf(e: any): string {
  const ids = [e.app_user_id, ...(Array.isArray(e.aliases) ? e.aliases : []), e.original_app_user_id].filter((id): id is string => typeof id === 'string' && id !== '')
  return ids.find(id => !id.startsWith('$RCAnonymousID:')) || ids[0] || ''
}

/** What a subscription is called in its row ids: all of its renewals share the original transaction. */
export function subscriptionKey(e: any): string {
  return String(e?.original_transaction_id || e?.transaction_id || '') || `${customerOf(e || {})}:${e?.product_id || ''}`
}

export type RevenueCatEffects = {
  payment?: PaymentRow
  /** A refund of a payment we may hold (`refunded: 0` takes one back). Nothing happens when we never saw the payment. */
  refund?: { stripeId: string, refunded: number }
  subscription?: SubscriptionRow
}

/**
 * What one event does to the rows. `prev` is the subscription as it was stored, null for a first
 * sight. Pure: the caller reads and saves.
 */
// ponytail: an introductory price is taken as the price until the next renewal brings the real one,
// and a subscription first seen on a renewal starts "now" for MRR by month (its earlier history is unknown).
export function revenueCatEffects(e: any, prev: SubscriptionRow | null): RevenueCatEffects {
  if (!e || e.environment === 'SANDBOX') return {}
  const type = String(e.type || '')
  const customerId = customerOf(e)
  const email = normalizeEmail(e.subscriber_attributes?.$email?.value)
  const txId = String(e.transaction_id || '')
  const eventSec = Math.floor((Number(e.event_timestamp_ms) || Number(e.purchased_at_ms) || 0) / 1000)
  const purchasedSec = Math.floor(Number(e.purchased_at_ms) / 1000) || eventSec
  const expiresSec = Math.floor(Number(e.expiration_at_ms) / 1000) || 0
  const minor = typeof e.price === 'number' ? toMinor(e.price, 'usd') : 0
  const out: RevenueCatEffects = {}

  if (PURCHASES.includes(type) && minor > 0) {
    out.payment = revenuePaymentRow(SOURCE, {
      id: txId || String(e.id), customerId, email, amount: minor, currency: 'usd', paidAtSec: purchasedSec,
      description: [e.product_id, STORES[String(e.store)]].filter(Boolean).join(' · ')
    })
  }
  // A refund comes as a CANCELLATION with a negative price; the refund itself being undone as REFUND_REVERSED.
  if (type === 'CANCELLATION' && e.cancel_reason === 'CUSTOMER_SUPPORT' && minor < 0 && txId) out.refund = { stripeId: rowKey(SOURCE, txId), refunded: -minor }
  if (type === 'REFUND_REVERSED' && txId) out.refund = { stripeId: rowKey(SOURCE, txId), refunded: 0 }

  if (!SUBSCRIPTION_EVENTS.includes(type)) return out
  // An event that arrives after a newer one (retries, queues) must not undo it.
  if (prev && eventSec < prev.eventAtSec) return out
  const id = subscriptionKey(e)
  const sub: SubscriptionInput = prev
    ? { ...prev, id }
    : { id, customerId, email, status: 'active', plan: '', currency: 'usd', amount: 0, monthly: 0, interval: 'month', startedAtSec: 0, paidFromMonth: '' }
  sub.customerId = customerId || sub.customerId
  sub.email = email || sub.email
  sub.eventAtSec = eventSec
  const plan = String(e.new_product_id || e.product_id || '')
  if (plan) sub.plan = plan

  if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL') {
    const trial = e.period_type === 'TRIAL'
    const months = periodMonths(expiresSec - purchasedSec)
    sub.status = trial ? 'trialing' : 'active'
    sub.cancelAtPeriodEnd = false
    sub.canceledAtSec = 0
    sub.endedMonth = ''
    if (expiresSec) sub.currentPeriodEndSec = expiresSec
    if (minor > 0 && months > 0) Object.assign(sub, { amount: minor, monthly: Math.round(minor / months), ...intervalOf(months) })
    if (type === 'INITIAL_PURCHASE') {
      sub.startedAtSec = purchasedSec
      sub.paidFromMonth = monthOf(trial ? expiresSec || purchasedSec : purchasedSec)
    } else if (e.is_trial_conversion || (!sub.paidFromMonth && minor > 0)) {
      sub.paidFromMonth = monthOf(purchasedSec)
    }
  } else if (type === 'CANCELLATION') {
    // A refund is dealt with above and does not always end the subscription: the EXPIRATION that follows does.
    if (e.cancel_reason !== 'CUSTOMER_SUPPORT') Object.assign(sub, { cancelAtPeriodEnd: true, canceledAtSec: eventSec })
  } else if (type === 'UNCANCELLATION') {
    Object.assign(sub, { cancelAtPeriodEnd: false, canceledAtSec: 0 })
  } else if (type === 'BILLING_ISSUE') {
    sub.status = 'past_due'
  } else if (type === 'SUBSCRIPTION_PAUSED') {
    sub.cancelAtPeriodEnd = true
  } else if (type === 'SUBSCRIPTION_EXTENDED') {
    if (expiresSec) sub.currentPeriodEndSec = expiresSec
  } else if (type === 'EXPIRATION') {
    sub.status = 'canceled'
    sub.canceledAtSec = sub.canceledAtSec || eventSec
    sub.endedMonth = monthOf(expiresSec || eventSec)
  }
  out.subscription = revenueSubscriptionRow(SOURCE, sub)
  return out
}

/** Applies one webhook body. Serialised per subscription, so two events for it never overwrite each other. */
export async function applyRevenueCatEvent(project: ParseObject, body: unknown): Promise<void> {
  const e = (body as { event?: unknown } | null)?.event as Record<string, any> | undefined
  if (!e || typeof e !== 'object') throw createError({ statusCode: 400, statusMessage: 'Not a RevenueCat webhook body' })
  const projectId = project.id || ''
  const Parse = useParse()
  const run = await runExclusive(`sb:revenuecat:${projectId}:${subscriptionKey(e) || e.id}`, 30, async () => {
    const stored = SUBSCRIPTION_EVENTS.includes(String(e.type))
      ? await new Parse.Query('StripeSubscription').equalTo('projectId', projectId).equalTo('stripeId', rowKey(SOURCE, subscriptionKey(e))).first(MASTER)
      : null
    const fx = revenueCatEffects(e, stored ? { ...stored.toJSON() } as unknown as SubscriptionRow : null)
    if (fx.payment) await saveRows('StripePayment', projectId, [fx.payment])
    if (fx.refund) {
      const paid = await new Parse.Query('StripePayment').equalTo('projectId', projectId).equalTo('stripeId', fx.refund.stripeId).first(MASTER)
      if (paid) {
        const amount = Number(paid.get('amount')) || 0
        const refunded = Math.min(amount, fx.refund.refunded)
        paid.set('refunded', refunded)
        paid.set('net', paid.get('status') === 'succeeded' ? amount - refunded : 0)
        await paid.save(null, MASTER)
      }
    }
    if (fx.subscription) await saveRows('StripeSubscription', projectId, [fx.subscription])
  }, { waitMs: 5000 })
  // RevenueCat retries anything but a 200, so a busy lock is worth a 503.
  if (!run.ran) throw createError({ statusCode: 503, statusMessage: 'Busy; try again' })
}
