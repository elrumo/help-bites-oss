import { describe, expect, test } from 'bun:test'
import { compileSegmentFilter, validateSegmentFilter } from '../shared/segments'
import { billingRules, fromMinor, monthlyMinor, rollupAttributes } from '../shared/stripe'
import { chargeRow, customerDto, lastMonths, mrrByMonth, subscriptionRow } from '../server/utils/stripe'

describe('stripe amounts', () => {
  test('minor units become currency units; zero-decimal currencies stay whole', () => {
    expect(fromMinor(1999, 'usd')).toBe(19.99)
    expect(fromMinor(500, 'JPY')).toBe(500)
  })

  test('monthly recurring revenue normalises the interval and quantity', () => {
    expect(monthlyMinor([{ quantity: 2, price: { unit_amount: 500, recurring: { interval: 'month' } } }])).toBe(1000)
    expect(monthlyMinor([{ price: { unit_amount: 12000, recurring: { interval: 'year' } } }])).toBe(1000)
    expect(monthlyMinor([{ price: { unit_amount: 3000, recurring: { interval: 'month', interval_count: 3 } } }])).toBe(1000)
    expect(monthlyMinor([{ price: { unit_amount: null, recurring: { interval: 'month' } } }])).toBe(0)
    expect(monthlyMinor([{ price: { unit_amount: 900 } }])).toBe(0)
  })
})

describe('charges and subscriptions', () => {
  test('a refunded charge keeps what stayed; a failed one keeps nothing', () => {
    const base = { id: 'ch_1', amount: 1000, currency: 'USD', created: 1_700_000_000, customer: { id: 'cus_1', email: 'Ada@X.io' } }
    expect(chargeRow({ ...base, status: 'succeeded', amount_refunded: 250 })).toMatchObject({ customerId: 'cus_1', email: 'ada@x.io', currency: 'usd', net: 750, month: '2023-11' })
    expect(chargeRow({ ...base, status: 'failed', amount_refunded: 0 }).net).toBe(0)
    expect(chargeRow({ ...base, customer: null, status: 'succeeded', billing_details: { email: 'G@x.io' } })).toMatchObject({ customerId: '', email: 'g@x.io' })
  })

  test('only subscriptions that pay today count towards MRR', () => {
    const sub = (status: string) => ({ id: 'sub_1', status, customer: 'cus_1', items: { data: [{ price: { product: 'prod_1', unit_amount: 500, currency: 'usd', recurring: { interval: 'month' } } }] } })
    const products = new Map([['prod_1', 'Pro']])
    expect(subscriptionRow(sub('active'), products)).toMatchObject({ plan: 'Pro', mrr: 500, amount: 500 })
    expect(subscriptionRow(sub('trialing'), products).mrr).toBe(0)
    expect(subscriptionRow(sub('canceled'), products).mrr).toBe(0)
  })

  test('a live customer keeps its credit as a negative balance; a deleted one is nobody', () => {
    expect(customerDto({ id: 'cus_1', email: 'Ada@X.io', created: 1_700_000_000, address: { country: 'ES' }, balance: -500, currency: 'EUR', delinquent: true, livemode: false }))
      .toEqual({ id: 'cus_1', name: '', email: 'ada@x.io', createdAt: '2023-11-14T22:13:20.000Z', country: 'ES', delinquent: true, balance: -500, currency: 'eur', livemode: false })
    expect(customerDto({ id: 'cus_2', deleted: true })).toBeNull()
    expect(customerDto(undefined)).toBeNull()
  })

  test('twelve months, oldest first, across a year boundary', () => {
    const months = lastMonths(new Date('2026-02-15T00:00:00Z'))
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-03')
    expect(months.at(-1)).toBe('2026-02')
  })

  test('MRR by month counts a subscription from the end of its trial until the month it ended', () => {
    const sub = { id: 'sub_1', status: 'canceled', customer: 'cus_1', start_date: 1_767_225_600, trial_end: 1_769_904_000, ended_at: 1_775_001_600, items: { data: [{ price: { unit_amount: 1200, recurring: { interval: 'year' } } }] } }
    expect(subscriptionRow(sub, new Map())).toMatchObject({ mrr: 0, monthly: 100, paidFromMonth: '2026-02', endedMonth: '2026-04' })
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
    // Ended Feb→Apr at 100 a month, plus one still running since March at today's 500.
    expect(mrrByMonth(months, [{ from: '2026-02', to: '2026-04', mrr: 0, monthly: 100 }, { from: '2026-03', to: '', mrr: 500, monthly: 500 }])).toEqual([0, 100, 600, 500, 500])
  })
})

describe('contact attributes and People filters', () => {
  test('a customer rolls up to the best subscription and zero revenue reads as never paid', () => {
    const attrs = rollupAttributes('cus_1', { net: 2500, count: 3, lastAt: 1_700_000_000 }, [{ status: 'canceled', plan: 'Old', mrr: 0 }, { status: 'active', plan: 'Pro', mrr: 1000 }], 'usd')
    expect(attrs).toMatchObject({ stripe_customer: 'cus_1', stripe_revenue: 25, stripe_payments: 3, stripe_mrr: 10, stripe_status: 'active', stripe_plan: 'Pro' })
    expect(rollupAttributes('cus_2', { net: 0, count: 0, lastAt: null }, [], 'usd')).toMatchObject({ stripe_revenue: null, stripe_payments: null, stripe_last_payment: null, stripe_status: 'none', stripe_plan: null })
  })

  test('billing filters compile to valid segment rules', () => {
    const rules = billingRules('past_due', 50)
    expect(rules).toEqual([{ field: 'attributes.stripe_status', op: 'is', value: 'past_due' }, { field: 'attributes.stripe_revenue', op: 'gt', value: 50 }])
    expect(validateSegmentFilter({ match: 'all', rules }).errors).toEqual([])
    expect(compileSegmentFilter({ match: 'all', rules: billingRules('never') })).toEqual({ 'attributes.stripe_revenue': { $exists: false } })
    expect(billingRules('all')).toEqual([])
    expect(billingRules('nonsense', Number.NaN)).toEqual([])
  })
})
