import { describe, expect, test } from 'bun:test'
import { DEFAULT_PRICING_CHECKOUT, DEFAULT_PRICING_OPTIONS, DEFAULT_PRICING_STYLE, buildPublicPricing, pricingLook, starterPricing, type PricingSnapshot, type PricingStyle } from '../shared/pricing'
import { normalizeProjectStyle } from '../shared/projectStyle'
import { pricingPage } from '../server/utils/pricing'

const kit = { accent: '#4f46e5', radiusPx: 8, fontFamily: 'system-ui', logoUrl: '', logoDarkUrl: '', iconUrl: '' }
const own = (over: Partial<PricingStyle> = {}): PricingStyle => ({ ...DEFAULT_PRICING_STYLE, ...over })
const snapshot = (style: PricingStyle): PricingSnapshot => ({ name: 'Pricing', template: 'tiers', ...starterPricing('tiers'), style, options: DEFAULT_PRICING_OPTIONS, checkout: DEFAULT_PRICING_CHECKOUT, locale: 'en', translations: {} })
const table = (projectStyle: unknown, style: PricingStyle) => {
  const look = pricingLook(kit, normalizeProjectStyle(projectStyle), style)
  return buildPublicPricing({ key: 'pricing', version: 1, publishedAt: null, project: { name: 'Acme', logoUrl: '', accent: look?.light.accent || kit.accent }, look, snapshot: snapshot(style), catalog: null })
}

describe('pricing wears the project style', () => {
  test('a project with no style gives the table no look to wear', () => {
    expect(pricingLook(kit, normalizeProjectStyle({}), own())).toBeNull()
    expect(table({}, own()).look).toBeNull()
  })

  test('the project style gives light and dark colours, radius and shadow', () => {
    const { look, style } = table({ light: { accent: '#e11d48' }, dark: { background: '#101820', surface: '#1b2733' }, radius: 6, shadow: 'strong' }, own())
    expect(look).toMatchObject({ radius: 6, shadow: 'strong' })
    expect(look!.light.accent).toBe('#e11d48')
    expect(look!.dark).toMatchObject({ accent: '#e11d48', surface: '#1b2733' })
    // The table's own fields stay as set; an empty accent is filled in.
    expect(style).toMatchObject({ accent: '#e11d48', background: '', radius: 16 })
  })

  test("the table's own fields win in light and dark", () => {
    const { look } = table({ light: { accent: '#e11d48' }, radius: 6 }, own({ accent: '#00aa00', background: '#fefefe', text: '#222222', radius: 24 }))
    expect(look!.light).toMatchObject({ accent: '#00aa00', background: '#fefefe', text: '#222222' })
    expect(look!.dark).toMatchObject({ accent: '#00aa00', background: '#fefefe' })
    expect(look!.radius).toBe(24)
  })

  test('a radius or font left at the default follows the project style', () => {
    expect(table({ radius: 4, font: 'mono' }, own()).look).toMatchObject({ radius: 4, fontFamily: expect.stringContaining('mono') })
    expect(table({ shadow: 'none' }, own()).look!.radius).toBe(16)
  })

  test('the hosted page carries the style, and a fixed scheme sets the script theme', () => {
    const dark = pricingPage(table({ scheme: 'dark', light: { accent: '#e11d48' } }, own()), 'pk_x')
    expect(dark).toContain('--accent:#e11d48')
    expect(dark).toContain('data-theme="dark"')
    expect(dark).not.toContain('@media (prefers-color-scheme:dark)')
    const auto = pricingPage(table({ light: { accent: '#e11d48' } }, own()), 'pk_x')
    expect(auto).toContain('@media (prefers-color-scheme:dark)')
    expect(auto).toContain('data-theme="system"')
    // No project style: the page is as it was.
    expect(pricingPage(table({}, own()), 'pk_x')).toContain('--bg: #f6f6f7')
  })
})
