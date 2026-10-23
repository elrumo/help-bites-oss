import { describe, expect, test } from 'bun:test'
import { OTHER_SOURCES, REVENUE_SOURCES, REVENUE_SOURCE_IDS, isRevenueSource, rowKey } from '../shared/revenue'
import { fromMinor, toMinor } from '../shared/stripe'
import { customRows } from '../server/utils/revenue/custom'
import { periodMonths, revenueCatEffects, subscriptionKey } from '../server/utils/revenue/revenuecat'
import { revenuePaymentRow, revenueSubscriptionRow } from '../server/utils/revenue/rows'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 2, 1, 10) // 2026-03-01T10:00Z

const purchase = (extra: Record<string, unknown> = {}) => ({
  type: 'INITIAL_PURCHASE', id: 'evt_1', event_timestamp_ms: T0, app_user_id: 'user_42', original_app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', 'user_42'],
  product_id: 'pro_monthly', period_type: 'NORMAL', purchased_at_ms: T0, expiration_at_ms: T0 + 30 * DAY, environment: 'PRODUCTION', store: 'APP_STORE',
  price: 9.99, currency: 'EUR', price_in_purchased_currency: 9.2, transaction_id: 'tx_1', original_transaction_id: 'tx_1',
  subscriber_attributes: { $email: { value: 'Ada@X.io' } }, ...extra
})

describe('source catalog', () => {
  test('every id has one entry, and only the sources HelpBites reads or hands a secret to ask for fields', () => {
    expect(REVENUE_SOURCES.map(s => s.id)).toEqual([...REVENUE_SOURCE_IDS])
    for (const s of REVENUE_SOURCES) {
      expect(new Set(s.fields.map(f => f.key)).size).toBe(s.fields.length)
      if (s.kind !== 'pull') expect(s.fields).toEqual([])
    }
    expect(OTHER_SOURCES).not.toContain('stripe')
    expect(isRevenueSource('apple')).toBe(true)
    expect(isRevenueSource('paypal')).toBe(false)
  })

  test('Stripe keeps its old ids; everything else is prefixed with its source', () => {
    expect(rowKey('stripe', 'ch_1')).toBe('ch_1')
    expect(rowKey('revenuecat', 'tx_1')).toBe('revenuecat:tx_1')
  })

  test('amounts go to the smallest unit and back', () => {
    expect(toMinor(19.99, 'usd')).toBe(1999)
    expect(toMinor(500, 'JPY')).toBe(500)
    expect(fromMinor(toMinor(0.07, 'eur'), 'eur')).toBe(0.07)
  })
})

describe('rows', () => {
  test('a payment keeps what stayed; a refunded or failed one keeps nothing', () => {
    const base = { id: 'p1', amount: 1000, currency: 'USD', paidAtSec: 1_700_000_000 }
    expect(revenuePaymentRow('custom', { ...base, refunded: 250 })).toMatchObject({ stripeId: 'custom:p1', source: 'custom', currency: 'usd', net: 750, month: '2023-11' })
    expect(revenuePaymentRow('custom', { ...base, status: 'failed' }).net).toBe(0)
    expect(revenuePaymentRow('custom', { ...base, refunded: 5000 })).toMatchObject({ refunded: 1000, net: 0 })
  })

  test('a negative line (Apple reports refunds that way) subtracts', () => {
    expect(revenuePaymentRow('apple', { id: 'd', amount: -300, currency: 'usd', paidAtSec: 1_700_000_000 })).toMatchObject({ amount: -300, refunded: 0, net: -300 })
  })

  test('only subscriptions that pay today count towards MRR', () => {
    const sub = (status: string) => revenueSubscriptionRow('custom', { id: 's1', status, plan: 'Pro', currency: 'USD', amount: 1200, monthly: 1200, interval: 'month', startedAtSec: 1_700_000_000 })
    expect(sub('active')).toMatchObject({ mrr: 1200, currency: 'usd', paidFromMonth: '2023-11' })
    expect(sub('past_due').mrr).toBe(1200)
    expect(sub('trialing').mrr).toBe(0)
    expect(sub('nonsense').status).toBe('incomplete')
  })
})

describe('RevenueCat events', () => {
  test('a purchase is a payment in USD and a subscription with its monthly price', () => {
    const fx = revenueCatEffects(purchase(), null)
    expect(fx.payment).toMatchObject({ stripeId: 'revenuecat:tx_1', source: 'revenuecat', customerId: 'user_42', email: 'ada@x.io', amount: 999, currency: 'usd', net: 999, description: 'pro_monthly · App Store' })
    expect(fx.subscription).toMatchObject({ stripeId: 'revenuecat:tx_1', status: 'active', plan: 'pro_monthly', mrr: 999, monthly: 999, interval: 'month', intervalCount: 1, paidFromMonth: '2026-03', startedAtSec: T0 / 1000 })
  })

  test('the customer is the app\'s user id, not the anonymous one', () => {
    expect(revenueCatEffects(purchase({ app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', 'user_42'] }), null).payment?.customerId).toBe('user_42')
    expect(revenueCatEffects(purchase({ app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc'] }), null).payment?.customerId).toBe('$RCAnonymousID:abc')
  })

  test('periods snap to the lengths stores sell, and a yearly price is a twelfth a month', () => {
    expect(periodMonths(31 * 86_400)).toBe(1)
    expect(periodMonths(366 * 86_400)).toBe(12)
    expect(periodMonths(0)).toBe(0)
    const yearly = revenueCatEffects(purchase({ price: 120, expiration_at_ms: T0 + 365 * DAY }), null).subscription
    expect(yearly).toMatchObject({ monthly: 1000, mrr: 1000, interval: 'year', intervalCount: 1, amount: 12000 })
    const weekly = revenueCatEffects(purchase({ price: 2, expiration_at_ms: T0 + 7 * DAY }), null).subscription
    expect(weekly).toMatchObject({ interval: 'week', monthly: Math.round(200 / (7 / 30.4375)) })
  })

  test('a free trial is a trialing subscription with no payment, and counts once it converts', () => {
    const trial = revenueCatEffects(purchase({ period_type: 'TRIAL', price: 0, expiration_at_ms: T0 + 7 * DAY }), null)
    expect(trial.payment).toBeUndefined()
    expect(trial.subscription).toMatchObject({ status: 'trialing', mrr: 0, paidFromMonth: '2026-03' })
    const converted = revenueCatEffects(purchase({ type: 'RENEWAL', is_trial_conversion: true, event_timestamp_ms: T0 + 7 * DAY, purchased_at_ms: T0 + 7 * DAY, expiration_at_ms: T0 + 37 * DAY, transaction_id: 'tx_2' }), trial.subscription!)
    expect(converted.payment).toMatchObject({ stripeId: 'revenuecat:tx_2', amount: 999 })
    expect(converted.subscription).toMatchObject({ status: 'active', mrr: 999, startedAtSec: T0 / 1000, paidFromMonth: '2026-03' })
  })

  test('renewals add a payment each and keep the subscription', () => {
    const first = revenueCatEffects(purchase(), null).subscription!
    const renewal = revenueCatEffects(purchase({ type: 'RENEWAL', event_timestamp_ms: T0 + 30 * DAY, purchased_at_ms: T0 + 30 * DAY, expiration_at_ms: T0 + 60 * DAY, transaction_id: 'tx_2' }), first)
    expect(renewal.payment?.stripeId).toBe('revenuecat:tx_2')
    expect(renewal.subscription).toMatchObject({ stripeId: first.stripeId, startedAtSec: T0 / 1000, currentPeriodEndSec: (T0 + 60 * DAY) / 1000 })
  })

  test('cancelling stops renewal; expiring ends the subscription in the month it ran out', () => {
    const live = revenueCatEffects(purchase(), null).subscription!
    const cancelled = revenueCatEffects(purchase({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', price: null, event_timestamp_ms: T0 + 5 * DAY }), live).subscription!
    expect(cancelled).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, mrr: 999, canceledAtSec: (T0 + 5 * DAY) / 1000 })
    expect(revenueCatEffects(purchase({ type: 'UNCANCELLATION', event_timestamp_ms: T0 + 6 * DAY }), cancelled).subscription).toMatchObject({ cancelAtPeriodEnd: false, canceledAtSec: 0 })
    const expired = revenueCatEffects(purchase({ type: 'EXPIRATION', price: null, event_timestamp_ms: T0 + 31 * DAY, expiration_at_ms: T0 + 30 * DAY }), cancelled).subscription!
    expect(expired).toMatchObject({ status: 'canceled', mrr: 0, endedMonth: '2026-03' })
  })

  test('a billing issue is past due and still counts; a renewal puts it right', () => {
    const live = revenueCatEffects(purchase(), null).subscription!
    const late = revenueCatEffects(purchase({ type: 'BILLING_ISSUE', event_timestamp_ms: T0 + 30 * DAY }), live).subscription!
    expect(late).toMatchObject({ status: 'past_due', mrr: 999 })
    expect(revenueCatEffects(purchase({ type: 'RENEWAL', event_timestamp_ms: T0 + 32 * DAY, purchased_at_ms: T0 + 32 * DAY, expiration_at_ms: T0 + 62 * DAY, transaction_id: 'tx_2' }), late).subscription?.status).toBe('active')
  })

  test('a refund is a negative cancellation: it refunds the payment it names and leaves the subscription alone', () => {
    const live = revenueCatEffects(purchase(), null).subscription!
    const fx = revenueCatEffects(purchase({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -9.99, event_timestamp_ms: T0 + DAY }), live)
    expect(fx.refund).toEqual({ stripeId: 'revenuecat:tx_1', refunded: 999 })
    expect(fx.subscription).toMatchObject({ cancelAtPeriodEnd: false, status: 'active' })
    expect(revenueCatEffects(purchase({ type: 'REFUND_REVERSED' }), live).refund).toEqual({ stripeId: 'revenuecat:tx_1', refunded: 0 })
  })

  test('an event older than the last one applied changes nothing', () => {
    const live = revenueCatEffects(purchase({ event_timestamp_ms: T0 + 10 * DAY }), null).subscription!
    expect(revenueCatEffects(purchase({ type: 'BILLING_ISSUE', event_timestamp_ms: T0 + 5 * DAY }), live).subscription).toBeUndefined()
  })

  test('a one-time purchase is a payment and no subscription; sandbox and unrelated events do nothing', () => {
    const once = revenueCatEffects(purchase({ type: 'NON_RENEWING_PURCHASE', product_id: 'coins', expiration_at_ms: null }), null)
    expect(once.payment).toMatchObject({ amount: 999, description: 'coins · App Store' })
    expect(once.subscription).toBeUndefined()
    expect(revenueCatEffects(purchase({ environment: 'SANDBOX' }), null)).toEqual({})
    expect(revenueCatEffects({ type: 'TEST', environment: 'PRODUCTION', app_user_id: 'x' }, null)).toEqual({})
    expect(revenueCatEffects(null, null)).toEqual({})
  })

  test('a product change renames the plan', () => {
    const live = revenueCatEffects(purchase(), null).subscription!
    expect(revenueCatEffects(purchase({ type: 'PRODUCT_CHANGE', new_product_id: 'pro_yearly', price: null, event_timestamp_ms: T0 + DAY }), live).subscription).toMatchObject({ plan: 'pro_yearly', mrr: 999 })
  })

  test('renewals of one subscription share a key; without a transaction it falls back to customer and product', () => {
    expect(subscriptionKey(purchase({ transaction_id: 'tx_9' }))).toBe('tx_1')
    expect(subscriptionKey({ app_user_id: 'u', product_id: 'p' })).toBe('u:p')
  })
})

describe('custom payments', () => {
  const NOW = 1_800_000_000

  test('decimals become minor units, dates default to now, ids are prefixed', () => {
    const { payments, subscriptions } = customRows({
      payments: [{ id: 'inv-1', amount: 19.99, currency: 'EUR', paidAt: '2026-03-01T10:00:00Z', email: 'Ada@X.io', refunded: 5 }, { id: 'inv-2', amount: 10, currency: 'usd' }],
      subscriptions: [{ id: 's1', plan: 'Pro', amount: 120, currency: 'usd', interval: 'year', status: 'active', startedAt: 1_772_359_200 }]
    }, NOW)
    expect(payments[0]).toMatchObject({ stripeId: 'custom:inv-1', amount: 1999, refunded: 500, net: 1499, currency: 'eur', email: 'ada@x.io', month: '2026-03' })
    expect(payments[1]!.paidAtSec).toBe(NOW)
    expect(subscriptions[0]).toMatchObject({ stripeId: 'custom:s1', mrr: 1000, monthly: 1000, amount: 12000, paidFromMonth: '2026-03', endedMonth: '' })
  })

  test('a canceled subscription with no end date ended when it was cancelled', () => {
    const { subscriptions } = customRows({ subscriptions: [{ id: 's1', plan: 'Pro', amount: 5, currency: 'usd', interval: 'month', status: 'canceled', startedAt: '2026-01-05T00:00:00Z', canceledAt: '2026-02-20T00:00:00Z' }] }, NOW)
    expect(subscriptions[0]).toMatchObject({ mrr: 0, endedMonth: '2026-02', monthly: 500 })
  })

  test('a bad row is refused by name', () => {
    const fail = (body: Record<string, unknown>) => { try { customRows(body, NOW) } catch (e) { return (e as { statusMessage: string }).statusMessage } return '' }
    expect(fail({})).toContain('send `payments`')
    expect(fail({ payments: [{ amount: 1, currency: 'usd' }] })).toContain('payments[0]: `id` is required')
    expect(fail({ payments: [{ id: 'a', amount: '1', currency: 'usd' }] })).toContain('payments[0].amount: must be a number')
    expect(fail({ payments: [{ id: 'a', amount: 1, currency: 'dollars' }] })).toContain('three-letter')
    expect(fail({ payments: [{ id: 'a', amount: 1, currency: 'usd', paidAt: 'yesterday' }] })).toContain('payments[0].paidAt')
    expect(fail({ subscriptions: [{ id: 'a', plan: 'p', amount: 1, currency: 'usd', interval: 'fortnight', status: 'active' }] })).toContain('interval')
    expect(fail({ subscriptions: [{ id: 'a', plan: 'p', amount: 1, currency: 'usd', interval: 'month', status: 'happy' }] })).toContain('status')
    expect(fail({ payments: 'nope' })).toContain('payments: must be an array')
    expect(fail({ payments: Array.from({ length: 501 }, (_, i) => ({ id: String(i), amount: 1, currency: 'usd' })) })).toContain('at most 500')
  })
})
