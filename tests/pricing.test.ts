import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PRICING_EXPERIMENT, addFunnel, compareConversion, emptyFunnel, pickPricingArm, validatePricingExperiment,
  DEFAULT_PRICING_CHECKOUT, DEFAULT_PRICING_CONTENT, DEFAULT_PRICING_OPTIONS, DEFAULT_PRICING_STYLE, PRICING_TEMPLATES, blankPlan, buildPublicPricing, catalogSubset,
  localizePricing, planLines, pricingSavings, pricingTexts, resolvePlanPrices, starterPricing, stripePriceFor, validatePricingContent, validatePricingFeatures,
  validatePricingOptions, validatePricingPlans, validatePricingStyle, validatePricingTranslations,
  type PricingPlan, type PricingSnapshot, type StripeCatalog, type StripeCatalogPrice
} from '../shared/pricing'
import { validateOnboardingSteps } from '../shared/onboarding'

const price = (over: Partial<StripeCatalogPrice>): StripeCatalogPrice => ({ id: 'price_x', product: 'prod_pro', currency: 'usd', amount: 1200, type: 'recurring', interval: 'month', intervalCount: 1, nickname: '', lookupKey: '', created: 1, currencyOptions: {}, ...over })

const catalog: StripeCatalog = {
  products: [{ id: 'prod_pro', name: 'Pro (Stripe)', description: 'From Stripe', defaultPrice: 'price_month2', unitLabel: 'seat', features: ['Sync'] }],
  prices: [
    price({ id: 'price_month1', created: 10 }),
    price({ id: 'price_month2', amount: 1500, created: 5 }),
    price({ id: 'price_year1', interval: 'year', amount: 12000, created: 20, currencyOptions: { eur: 11000 } }),
    price({ id: 'price_year0', interval: 'year', amount: 9000, created: 30, currency: 'gbp' }),
    price({ id: 'price_life', type: 'one_time', interval: '', amount: 29900, created: 3 }),
    price({ id: 'price_week', interval: 'week', amount: 300, created: 40 }),
    price({ id: 'price_other', product: 'prod_other', amount: 100 })
  ],
  links: [{ id: 'plink_1', url: 'https://buy.stripe.com/test_year', prices: ['price_year1'], trialDays: 30 }],
  fetchedAt: '2026-10-21T00:00:00.000Z'
}

function stripePlan(over: Partial<PricingPlan> = {}): PricingPlan {
  return { ...blankPlan('Pro', 'pro'), stripeProduct: 'prod_pro', trialDays: 14, ...over }
}

function snapshot(over: Partial<PricingSnapshot> = {}): PricingSnapshot {
  return { name: 'Pricing', template: 'tiers', ...starterPricing('tiers'), style: DEFAULT_PRICING_STYLE, options: DEFAULT_PRICING_OPTIONS, checkout: DEFAULT_PRICING_CHECKOUT, locale: 'en', translations: {}, ...over }
}

describe('starter tables', () => {
  test('every template starts with plans and rows that pass validation', () => {
    for (const template of PRICING_TEMPLATES) {
      const start = starterPricing(template)
      expect(start.plans.length).toBeGreaterThan(0)
      expect(validatePricingFeatures(start.features).errors).toEqual([])
      expect(validatePricingPlans(start.plans, start.features.map(f => f.id)).errors).toEqual([])
    }
    expect(starterPricing('matrix').features.some(f => f.kind === 'heading')).toBe(true)
    expect(starterPricing('paywall').plans).toHaveLength(1)
  })
})

describe('validation', () => {
  test('plan keys are made from names and kept unique; a key sent twice is refused', () => {
    const made = validatePricingPlans([{ name: 'Pro plan' }, { name: 'Pro plan' }], [])
    expect(made.errors).toEqual([])
    expect(made.plans.map(p => p.key)).toEqual(['pro-plan', 'pro-plan-2'])
    expect(validatePricingPlans([{ name: 'A', key: 'pro' }, { name: 'B', key: 'pro' }], []).errors.join()).toContain('already uses the key "pro"')
  })

  test('Stripe ids, amounts, trials and actions are checked', () => {
    const { errors } = validatePricingPlans([{ name: 'X', stripeProduct: 'nope', prices: { month: { stripePrice: 'p_1', amount: -1 } }, trialDays: 1000, action: { type: 'buy' } }], [])
    expect(errors.join('\n')).toContain('stripeProduct must be a Stripe product id')
    expect(errors.join('\n')).toContain('prices.month.stripePrice must be a Stripe price id')
    expect(errors.join('\n')).toContain('prices.month.amount is a price')
    expect(errors.join('\n')).toContain('trialDays is a whole number')
    expect(errors.join('\n')).toContain('action.type is one of')
    expect(validatePricingPlans([{ name: '' }], []).errors).toEqual(['Plan 1 needs a name or a Stripe product'])
  })

  test('a URL action keeps its {plan} and {interval} placeholders', () => {
    const { plans, errors } = validatePricingPlans([{ name: 'Team', action: { type: 'url', url: 'https://acme.test/signup/{plan}?billing={interval}' } }], [])
    expect(errors).toEqual([])
    expect(plans[0]!.action.url).toBe('https://acme.test/signup/{plan}?billing={interval}')
    expect(validatePricingPlans([{ name: 'Team', action: { type: 'url', url: 'javascript:alert(1)' } }], []).errors.join()).toContain('action.url must be an http(s) URL')
  })

  test('values are kept only for the table\'s rows, and false is not stored', () => {
    const { plans } = validatePricingPlans([{ name: 'A', features: { ft_a: true, ft_b: false, ft_c: ' 10 ', ft_gone: true } }], ['ft_a', 'ft_b', 'ft_c'])
    expect(plans[0]!.features).toEqual({ ft_a: true, ft_c: '10' })
  })

  test('feature rows need text and get ids; headings have no hint', () => {
    const { features, errors } = validatePricingFeatures([{ text: 'Usage', kind: 'heading', hint: 'x' }, { text: '' }])
    expect(features[0]).toMatchObject({ kind: 'heading', hint: '' })
    expect(features[0]!.id).toMatch(/^ft_/)
    expect(errors).toEqual(['Feature 2 has no text'])
  })

  test('style, options and content merge onto what was there', () => {
    expect(validatePricingStyle({ radius: 8, highlight: 'raise' }).style).toMatchObject({ radius: 8, highlight: 'raise', density: 'comfortable' })
    expect(validatePricingStyle({ accent: 'red', surface: 'glass' }).errors).toHaveLength(2)
    expect(validatePricingOptions({ currency: 'EUR', cumulative: true }).options).toMatchObject({ currency: 'eur', cumulative: true, defaultInterval: 'year' })
    expect(validatePricingOptions({ currency: 'euro' }).errors).toHaveLength(1)
    expect(validatePricingContent({ termsUrl: 'ftp://x' }, DEFAULT_PRICING_CONTENT).errors).toEqual(['content.termsUrl must be an http(s) URL'])
  })
})

describe('Stripe prices', () => {
  test('a named price wins while it is active; an archived one falls back to the product', () => {
    expect(stripePriceFor(stripePlan({ prices: { ...blankPlan().prices, month: { stripePrice: 'price_month1', amount: null, appStoreProduct: '' } } }), 'month', catalog, 'usd')?.id).toBe('price_month1')
    expect(stripePriceFor(stripePlan({ prices: { ...blankPlan().prices, month: { stripePrice: 'price_gone', amount: null, appStoreProduct: '' } } }), 'month', catalog, 'usd')?.id).toBe('price_month2')
  })

  test('without a named price: the product\'s default, else its newest in the table\'s currency', () => {
    expect(stripePriceFor(stripePlan(), 'month', catalog, 'usd')?.id).toBe('price_month2')
    expect(stripePriceFor(stripePlan(), 'year', catalog, 'usd')?.id).toBe('price_year1')
    expect(stripePriceFor(stripePlan(), 'year', catalog, 'gbp')?.id).toBe('price_year0')
    expect(stripePriceFor(stripePlan(), 'once', catalog, 'usd')?.id).toBe('price_life')
    expect(stripePriceFor(stripePlan(), 'month', null, 'usd')).toBeNull()
  })

  test('prices resolve to units, with the monthly share of a year, the trial and where the button goes', () => {
    const prices = resolvePlanPrices(stripePlan(), catalog, { currency: 'usd', checkoutUrl: 'https://hb.test/v1/pricing/pk_1/pricing/checkout' })
    expect(prices.month).toMatchObject({ amount: 15, currency: 'usd', source: 'stripe', stripePrice: 'price_month2', trialDays: 14, href: 'https://hb.test/v1/pricing/pk_1/pricing/checkout?plan=pro&interval=month' })
    expect(prices.year).toMatchObject({ amount: 120, monthly: 10 })
    expect(prices.once).toMatchObject({ amount: 299, trialDays: 0 })
  })

  test('a currency the price also sells in is used when asked for', () => {
    expect(resolvePlanPrices(stripePlan(), catalog, { currency: 'usd', wanted: 'eur' }).year).toMatchObject({ amount: 110, currency: 'eur' })
    expect(resolvePlanPrices(stripePlan(), catalog, { currency: 'usd', wanted: 'jpy' }).year).toMatchObject({ amount: 120, currency: 'usd' })
  })

  test('payment links carry their own trial; URL actions fill in the plan and interval; none has no link', () => {
    const linked = resolvePlanPrices(stripePlan({ action: { type: 'payment_link', label: '', url: '' } }), catalog, { currency: 'usd' })
    expect(linked.year).toMatchObject({ href: 'https://buy.stripe.com/test_year', trialDays: 30 })
    expect(linked.month!.href).toBeNull()
    const url = resolvePlanPrices(stripePlan({ action: { type: 'url', label: '', url: 'https://acme.test/s?p={plan}&i={interval}' } }), catalog, { currency: 'usd' })
    expect(url.month!.href).toBe('https://acme.test/s?p=pro&i=month')
    expect(resolvePlanPrices(stripePlan({ action: { type: 'none', label: '', url: '' } }), catalog, { currency: 'usd', checkoutUrl: 'x' }).month!.href).toBeNull()
  })

  test('hand-written prices show when Stripe has none, and get no checkout link', () => {
    const plan = blankPlan('Team', 'team')
    plan.prices.month.amount = 29
    expect(resolvePlanPrices(plan, catalog, { currency: 'eur', checkoutUrl: 'x' }).month).toMatchObject({ amount: 29, currency: 'eur', source: 'manual', href: null })
  })

  test('the yearly saving is rounded down, and only between comparable prices', () => {
    expect(pricingSavings({ amount: 12, currency: 'usd', intervalCount: 1 }, { amount: 120, currency: 'usd', intervalCount: 1 })).toBe(16)
    expect(pricingSavings({ amount: 10, currency: 'usd', intervalCount: 1 }, { amount: 130, currency: 'usd', intervalCount: 1 })).toBe(0)
    expect(pricingSavings({ amount: 10, currency: 'usd', intervalCount: 1 }, { amount: 100, currency: 'eur', intervalCount: 1 })).toBe(0)
    expect(pricingSavings({ amount: 0, currency: 'usd', intervalCount: 1 }, { amount: 0, currency: 'usd', intervalCount: 1 })).toBe(0)
  })

  test('the copy kept with a version has only what its plans use', () => {
    const kept = catalogSubset({ plans: [stripePlan()] }, catalog)!
    expect(kept.products.map(p => p.id)).toEqual(['prod_pro'])
    expect(kept.prices.map(p => p.id)).not.toContain('price_other')
    expect(kept.links.map(l => l.id)).toEqual(['plink_1'])
  })
})

describe('feature lists', () => {
  const rows = validatePricingFeatures([{ id: 'a', text: 'Projects' }, { id: 'h', kind: 'heading', text: 'Support' }, { id: 'b', text: 'Email' }, { id: 'c', text: 'SSO' }]).features
  const starter = { features: { a: '1', b: true } }
  const pro = { features: { a: '10', b: true, c: true } }

  test('a card lists what is included, with values, and the rest only when asked', () => {
    expect(planLines(starter, rows, { cumulative: false, showExcluded: false }).map(l => [l.text, l.value])).toEqual([['Projects', '1'], ['Email', '']])
    expect(planLines(starter, rows, { cumulative: false, showExcluded: true }).map(l => l.included)).toEqual([true, true, false])
  })

  test('cumulative lists only what a plan adds or changes', () => {
    expect(planLines(pro, rows, { cumulative: true, showExcluded: true }, starter).map(l => l.id)).toEqual(['a', 'c'])
  })
})

describe('translations', () => {
  const table = snapshot()
  const pro = table.plans[1]!
  const projects = table.features[0]!

  test('texts are flat keys of every non-empty string, values included', () => {
    const texts = pricingTexts(table)
    expect(texts['content/title']).toBe('Simple pricing')
    expect(texts[`plans/${pro.id}/badge`]).toBe('Most popular')
    expect(texts[`features/${projects.id}/text`]).toBe('Projects')
    expect(texts[`plans/${pro.id}/cells/${projects.id}`]).toBe('10')
    expect(Object.keys(texts).some(k => k.endsWith('/hint'))).toBe(false)
  })

  test('unknown keys and the table\'s own language are refused; null removes a language', () => {
    const first = validatePricingTranslations({ es: { 'content/title': 'Precios', 'plans/nope/name': 'x' }, en: {} }, table, 'en')
    expect(first.translations).toEqual({ es: { 'content/title': 'Precios' } })
    expect(first.errors).toEqual(['en is the table\'s own language'])
    expect(validatePricingTranslations({ es: null }, table, 'en', first.translations).translations).toEqual({})
  })

  test('localizing replaces what is translated and keeps the rest', () => {
    const words = localizePricing(table, { 'content/title': 'Precios', [`plans/${pro.id}/badge`]: 'El más popular', [`features/${projects.id}/text`]: 'Proyectos', [`plans/${pro.id}/cells/${projects.id}`]: 'diez' })
    expect(words.content.title).toBe('Precios')
    expect(words.content.subtitle).toBe(table.content.subtitle)
    expect(words.plans[1]!.badge).toBe('El más popular')
    expect(words.plans[1]!.name).toBe('Pro')
    expect(words.features[0]!.text).toBe('Proyectos')
    expect(words.plans[1]!.features[projects.id]).toBe('diez')
  })
})

describe('the public table', () => {
  const project = { name: 'Acme', logoUrl: '', accent: '#123456' }

  test('copy in the language asked for, prices, the toggle\'s slots and the best saving', () => {
    const table = snapshot({ translations: { es: { 'content/title': 'Precios' }, fr: {} } })
    const out = buildPublicPricing({ key: 'pricing', version: 2, publishedAt: null, project, snapshot: table, catalog: null, wanted: { locales: ['es-MX'] } })
    expect(out.locale).toBe('es')
    // A language with nothing written yet is not offered.
    expect(out.locales).toEqual(['en', 'es'])
    expect(out.content.title).toBe('Precios')
    expect(out.style.accent).toBe('#123456')
    expect(out.intervals).toEqual(['month', 'year'])
    expect(out.savings).toBe(16)
    expect(out.plans[0]!.prices.month!.amount).toBe(0)
    expect(out.plans[1]!.cells[table.features[4]!.id]).toBe(false)
    expect('currency' in out.options).toBe(false)
  })

  test('a Stripe plan takes the product\'s name and description unless it has its own, and says what it builds on', () => {
    const plans = [blankPlan('Free', 'free'), stripePlan({ name: '', description: '' })]
    plans[0]!.prices.month.amount = 0
    const out = buildPublicPricing({ key: 't', version: 1, publishedAt: null, project, snapshot: snapshot({ plans, options: { ...DEFAULT_PRICING_OPTIONS, cumulative: true } }), catalog, checkoutUrl: 'https://hb.test/c' })
    expect(out.plans[1]).toMatchObject({ name: 'Pro (Stripe)', description: 'From Stripe', unitLabel: 'seat', includes: 'Free', savings: 33 })
    // The weekly price of the catalogue fills the week slot.
    expect(out.intervals).toEqual(['week', 'month', 'year', 'once'])
  })

  test('a URL plan without a price still has a link for its button', () => {
    const enterprise = blankPlan('Enterprise', 'enterprise')
    enterprise.customPrice = 'Custom'
    enterprise.action = { type: 'url', label: 'Contact us', url: 'https://acme.test/contact?plan={plan}' }
    const out = buildPublicPricing({ key: 't', version: 1, publishedAt: null, project, snapshot: snapshot({ plans: [enterprise] }), catalog: null })
    expect(out.plans[0]!.action).toEqual({ type: 'url', label: 'Contact us', href: 'https://acme.test/contact?plan=enterprise' })
    expect(out.plans[0]!.prices).toEqual({})
  })
})

describe('onboarding steps with a pricing table', () => {
  test('a step can be only a pricing table, named by its key', () => {
    const { steps, errors } = validateOnboardingSteps([{ pricingTable: 'Pro-Paywall' }, { title: 'Hi', pricingTable: 'not a key!' }])
    expect(steps[0]!.pricingTable).toBe('pro-paywall')
    expect(errors).toEqual(['Step 2: pricingTable is the key of a pricing table'])
  })
})

describe('currencies', () => {
  const project = { name: 'Acme', logoUrl: '', accent: '#123456' }

  test('written prices in other currencies are used when every price has the one asked for', () => {
    const plans = [blankPlan('Pro', 'pro'), blankPlan('Team', 'team')]
    plans[0]!.prices.month = { stripePrice: '', amount: 10, amounts: { eur: 9, gbp: 8 }, appStoreProduct: '' }
    plans[1]!.prices.month = { stripePrice: '', amount: 20, amounts: { eur: 18 }, appStoreProduct: '' }
    const table = (currency: string) => buildPublicPricing({ key: 't', version: 1, publishedAt: null, project, snapshot: snapshot({ plans }), catalog: null, wanted: { currency } })
    expect(table('eur').currencies).toEqual(['usd', 'eur'])
    expect(table('eur').plans.map(p => p.prices.month!.amount)).toEqual([9, 18])
    expect(table('eur').currency).toBe('eur')
    // Only Pro has pounds: the table stays in its own currency rather than mixing two.
    expect(table('gbp').plans.map(p => [p.prices.month!.amount, p.prices.month!.currency])).toEqual([[10, 'usd'], [20, 'usd']])
    expect(table('gbp').currency).toBe('usd')
  })

  test('Stripe prices offer their other currencies', () => {
    const out = buildPublicPricing({ key: 't', version: 1, publishedAt: null, project, snapshot: snapshot({ plans: [stripePlan({ prices: { ...blankPlan().prices, year: { stripePrice: 'price_year1', amount: null, amounts: {}, appStoreProduct: '' } }, stripeProduct: '' })] }), catalog, wanted: { currency: 'eur' } })
    expect(out.currencies).toEqual(['usd', 'eur'])
    expect(out.plans[0]!.prices.year).toMatchObject({ amount: 110, currency: 'eur' })
  })

  test('written amounts in other currencies are checked', () => {
    expect(validatePricingPlans([{ name: 'A', prices: { month: { amount: 5, amounts: { euro: 4, gbp: -1 } } } }], []).errors).toEqual(['Plan 1: prices.month.amounts: "euro" is not a three-letter currency code', 'Plan 1: prices.month.amounts.gbp is a price from 0 to 1000000, or null'])
  })
})

describe('A/B tests', () => {
  const running = { ...DEFAULT_PRICING_EXPERIMENT, status: 'running' as const, runId: 'run1', weight: 50, variants: [{ table: 'pricing-b', weight: 50 }] }

  test('a visitor always gets the same table, and the split follows the weights', () => {
    const pick = (visitor: string) => pickPricingArm(running, 'pricing', visitor, ['pricing-b'])
    expect(pick('visitor-1')).toBe(pick('visitor-1'))
    const tally = { pricing: 0, 'pricing-b': 0 } as Record<string, number>
    for (let i = 0; i < 4000; i++) tally[pick(`v${i}`)]!++
    expect(tally.pricing! / 4000).toBeGreaterThan(0.45)
    expect(tally.pricing! / 4000).toBeLessThan(0.55)
  })

  test('a variant that is not published gets nobody; a new run reshuffles', () => {
    expect(pickPricingArm(running, 'pricing', 'v', [])).toBe('pricing')
    const all = Array.from({ length: 200 }, (_, i) => `v${i}`)
    const first = all.map(v => pickPricingArm(running, 'pricing', v, ['pricing-b']))
    const second = all.map(v => pickPricingArm({ ...running, runId: 'run2' }, 'pricing', v, ['pricing-b']))
    expect(first).not.toEqual(second)
  })

  test('settings: other tables only, at most three, weights 0 to 100', () => {
    expect(validatePricingExperiment({ variants: [{ table: 'pricing', weight: 50 }] }, 'pricing').errors).toEqual(['Variant 1: a table cannot be its own variant'])
    expect(validatePricingExperiment({ weight: 101 }, 'pricing').errors).toEqual(['experiment.weight is a whole number from 0 to 100'])
    expect(validatePricingExperiment({ weight: 0, variants: [] }, 'pricing').errors).toEqual(['At least one table needs a weight above 0'])
    expect(validatePricingExperiment({ variants: [{ table: 'b' }, { table: 'c', weight: 20 }] }, 'pricing').experiment.variants).toEqual([{ table: 'b', weight: 50 }, { table: 'c', weight: 20 }])
  })

  test('the verdict: lift and confidence, and not before there is enough to go on', () => {
    const clear = compareConversion({ visitors: 2000, conversions: 40 }, { visitors: 2000, conversions: 80 })
    expect(clear.lift).toBeCloseTo(1)
    expect(clear.confidence).toBeGreaterThan(0.99)
    expect(clear.enough).toBe(true)
    const noise = compareConversion({ visitors: 1000, conversions: 20 }, { visitors: 1000, conversions: 22 })
    expect(noise.confidence).toBeLessThan(0.5)
    expect(compareConversion({ visitors: 10, conversions: 1 }, { visitors: 12, conversions: 2 }).enough).toBe(false)
    expect(compareConversion({ visitors: 0, conversions: 0 }, { visitors: 0, conversions: 0 })).toEqual({ rate: 0, lift: null, confidence: 0, enough: false })
  })

  test('funnels add up by plan and by currency', () => {
    const total = addFunnel(addFunnel(emptyFunnel(), { views: 3, conversions: 1, revenue: { usd: 1200 }, plans: { pro: { clicks: 2, checkouts: 1, conversions: 1 } } }), { views: 2, revenue: { usd: 800, eur: 500 }, plans: { pro: { clicks: 1, checkouts: 0, conversions: 0 } } })
    expect(total).toMatchObject({ views: 5, conversions: 1, revenue: { usd: 2000, eur: 500 }, plans: { pro: { clicks: 3, checkouts: 1, conversions: 1 } } })
  })
})
