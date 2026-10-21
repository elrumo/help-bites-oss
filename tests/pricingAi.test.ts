import { describe, expect, test } from 'bun:test'
import { normalizeOrigin } from '../server/utils/projects'
import { starterPricing, DEFAULT_PRICING_CHECKOUT, DEFAULT_PRICING_OPTIONS, DEFAULT_PRICING_STYLE, type PricingSnapshot } from '../shared/pricing'

// How an AI suggestion lands on a pricing table: only what was asked for changes,
// existing plans keep their Stripe links and buttons, and values follow their rows.

Object.assign(globalThis, { normalizeOrigin })
const { applySuggestion } = await import('../server/utils/pricingAi')

function table(): PricingSnapshot {
  const snapshot: PricingSnapshot = { name: 'Pricing', template: 'tiers', ...starterPricing('tiers'), style: DEFAULT_PRICING_STYLE, options: DEFAULT_PRICING_OPTIONS, checkout: DEFAULT_PRICING_CHECKOUT, locale: 'en', translations: {} }
  const pro = snapshot.plans.find(p => p.key === 'pro')!
  pro.stripeProduct = 'prod_Pro1234'
  pro.prices.month.stripePrice = 'price_promonth1'
  pro.prices.month.amounts = { eur: 9 }
  pro.action = { type: 'checkout', label: 'Upgrade', url: '' }
  return snapshot
}

const answer = (current: PricingSnapshot) => {
  const pro = current.plans.find(p => p.key === 'pro')!
  return {
    content: { title: 'Ship support in an afternoon', subtitle: 'One toolkit', footnote: '' },
    features: [{ text: 'Projects' }, { text: 'Custom domains', hint: 'Your own address' }],
    plans: [
      { id: pro.id, name: 'Pro+', description: 'For teams', prices: { month: 15 }, features: { Projects: '20', 'Custom domains': true, 'Not a row': true } },
      { id: '', key: 'scale', name: 'Scale', prices: { month: 49, year: 490, week: null, once: null }, features: { Projects: 'Unlimited' } }
    ]
  }
}

describe('applySuggestion', () => {
  test('only the words change when only copy is asked for', () => {
    const current = table()
    const draft = applySuggestion(current, answer(current), ['copy'])
    expect(draft.content.title).toBe('Ship support in an afternoon')
    expect(draft.features).toEqual(current.features)
    const pro = draft.plans.find(p => p.key === 'pro')!
    expect(pro.name).toBe('Pro+')
    expect(pro.features).toEqual(current.plans.find(p => p.key === 'pro')!.features)
    expect(pro.prices.month.amount).toBe(current.plans.find(p => p.key === 'pro')!.prices.month.amount)
  })

  test('an existing plan keeps its Stripe link, other currencies and button', () => {
    const current = table()
    const draft = applySuggestion(current, answer(current), ['copy', 'features', 'prices'])
    const pro = draft.plans.find(p => p.key === 'pro')!
    expect(pro.id).toBe(current.plans.find(p => p.key === 'pro')!.id)
    expect(pro.stripeProduct).toBe('prod_Pro1234')
    expect(pro.prices.month).toMatchObject({ stripePrice: 'price_promonth1', amount: 15, amounts: { eur: 9 } })
    // A slot the answer leaves out keeps what the plan had.
    expect(pro.prices.year.amount).toBe(current.plans.find(p => p.key === 'pro')!.prices.year.amount)
    expect(pro.action).toEqual({ type: 'checkout', label: 'Upgrade', url: '' })
  })

  test('features are matched by their words, and values follow the rows', () => {
    const current = table()
    const draft = applySuggestion(current, answer(current), ['features'])
    const projects = current.features.find(f => f.text === 'Projects')!
    expect(draft.features.find(f => f.text === 'Projects')!.id).toBe(projects.id)
    const domains = draft.features.find(f => f.text === 'Custom domains')!
    expect(domains.hint).toBe('Your own address')
    const pro = draft.plans.find(p => p.key === 'pro')!
    expect(pro.features).toEqual({ [projects.id]: '20', [domains.id]: true })
    expect(draft.features.map(f => f.text)).toEqual(['Projects', 'Custom domains'])
  })

  test('a new plan comes in whole, with a key', () => {
    const current = table()
    const draft = applySuggestion(current, answer(current), ['prices'])
    const scale = draft.plans.find(p => p.key === 'scale')!
    expect(scale.name).toBe('Scale')
    expect(scale.prices.month.amount).toBe(49)
    expect(scale.prices.year.amount).toBe(490)
    expect(scale.prices.week.amount).toBeNull()
    expect(draft.plans).toHaveLength(2)
  })
})
