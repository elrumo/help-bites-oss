import { afterEach, describe, expect, test } from 'bun:test'
import { normalizeOrigin } from '../server/utils/projects'

// The Stripe side of pricing tables: reading the catalog through a restricted key
// (answered here by a fake Stripe) and which return addresses a checkout accepts.

Object.assign(globalThis, { normalizeOrigin })
const { fetchStripeCatalog, allowedReturnUrl } = await import('../server/utils/pricing')

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function fakeStripe(answers: Record<string, unknown>, seen: string[] = []) {
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url)
    seen.push(`${u.pathname}?${u.searchParams}`)
    const body = answers[u.pathname]
    if (body === undefined) return new Response(JSON.stringify({ error: { message: 'The provided key does not have the required permissions' } }), { status: 403 })
    return new Response(JSON.stringify(Array.isArray(body) ? { data: body, has_more: false } : body))
  }) as never
}

describe('the Stripe catalog', () => {
  test('active products, fixed prices with their other currencies, and payment links with their prices', async () => {
    const seen: string[] = []
    fakeStripe({
      '/v1/products': [{ id: 'prod_1', name: 'Pro', description: 'All of it', default_price: 'price_m', unit_label: 'seat', marketing_features: [{ name: 'Sync' }, {}] }],
      '/v1/prices': [
        { id: 'price_m', product: 'prod_1', currency: 'USD', unit_amount: 900, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, created: 5, currency_options: { usd: { unit_amount: 900 }, eur: { unit_amount: 800 } } },
        { id: 'price_tiered', product: 'prod_1', currency: 'usd', unit_amount: null, type: 'recurring', recurring: { interval: 'month' } },
        { id: 'price_metered', product: 'prod_1', currency: 'usd', unit_amount: 1, type: 'recurring', recurring: { interval: 'month', usage_type: 'metered' } }
      ],
      '/v1/payment_links': [
        { id: 'plink_1', url: 'https://buy.stripe.com/a', subscription_data: { trial_period_days: 7 }, line_items: { data: [{ price: { id: 'price_m' } }] } },
        { id: 'plink_2', url: 'https://buy.stripe.com/b' }
      ],
      '/v1/payment_links/plink_2/line_items': [{ price: { id: 'price_y' } }]
    }, seen)
    const { catalog, paymentLinks } = await fetchStripeCatalog('rk_test_x')
    expect(paymentLinks).toBe(true)
    expect(catalog.products).toEqual([{ id: 'prod_1', name: 'Pro', description: 'All of it', defaultPrice: 'price_m', unitLabel: 'seat', features: ['Sync'] }])
    expect(catalog.prices.map(p => p.id)).toEqual(['price_m'])
    expect(catalog.prices[0]).toMatchObject({ currency: 'usd', amount: 900, interval: 'month', currencyOptions: { usd: 900, eur: 800 } })
    expect(catalog.links).toEqual([{ id: 'plink_1', url: 'https://buy.stripe.com/a', prices: ['price_m'], trialDays: 7 }, { id: 'plink_2', url: 'https://buy.stripe.com/b', prices: ['price_y'], trialDays: 0 }])
    expect(seen.some(s => s.startsWith('/v1/prices?') && s.includes('active=true') && s.includes('currency_options'))).toBe(true)
  })

  test('a key that cannot read payment links still gives products and prices', async () => {
    fakeStripe({ '/v1/products': [], '/v1/prices': [] })
    const { catalog, paymentLinks } = await fetchStripeCatalog('rk_test_x')
    expect(paymentLinks).toBe(false)
    expect(catalog.links).toEqual([])
  })

  test('a key that cannot read products fails, with Stripe\'s reason', async () => {
    fakeStripe({ '/v1/prices': [] })
    await expect(fetchStripeCatalog('rk_test_x')).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('checkout return addresses', () => {
  test('any https page while the project lists no origins; only listed ones (and HelpBites) once it does', () => {
    expect(allowedReturnUrl('https://shop.test/pricing?x=1', [], 'https://hb.test')).toBe('https://shop.test/pricing?x=1')
    expect(allowedReturnUrl('https://evil.test/', ['https://shop.test'], 'https://hb.test')).toBe('')
    expect(allowedReturnUrl('https://shop.test/a', ['https://shop.test'], 'https://hb.test')).toBe('https://shop.test/a')
    expect(allowedReturnUrl('https://hb.test/pricing/pk/x', ['https://shop.test'], 'https://hb.test')).toBe('https://hb.test/pricing/pk/x')
    expect(allowedReturnUrl('javascript:alert(1)', [], 'https://hb.test')).toBe('')
  })
})

describe('purging the CDN', () => {
  test('does nothing without a key, else asks Bunny.net to drop each URL', async () => {
    const { purgeCdn } = await import('../server/utils/cdnPurge')
    delete process.env.BUNNY_NET_API_KEY
    expect(await purgeCdn(['https://a.test/x*'])).toBeNull()
    process.env.BUNNY_NET_API_KEY = 'k'
    const seen: { url: string, key: string }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, key: (init.headers as Record<string, string>).AccessKey! })
      return new Response('', { status: seen.length === 2 ? 401 : 200 })
    }) as never
    const out = await purgeCdn(['https://a.test/v1/pricing/pk/p*', 'https://a.test/pricing/pk/p*', 'https://a.test/v1/pricing/pk/p*'])
    delete process.env.BUNNY_NET_API_KEY
    expect(seen.map(s => s.url)).toEqual([`https://api.bunny.net/purge?url=${encodeURIComponent('https://a.test/v1/pricing/pk/p*')}&async=false`, `https://api.bunny.net/purge?url=${encodeURIComponent('https://a.test/pricing/pk/p*')}&async=false`])
    expect(seen[0]!.key).toBe('k')
    expect(out).toEqual({ purged: 1, error: 'Bunny.net answered 401' })
  })
})
