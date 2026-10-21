import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRICING_ACTIONS, PRICING_DENSITIES, PRICING_FONTS, PRICING_HIGHLIGHTS, PRICING_INTERVALS, PRICING_KEY, PRICING_LIMITS, PRICING_MAX_LOCALES,
  PRICING_MAX_VARIANTS, PRICING_RECURRING, PRICING_SURFACES, PRICING_TEMPLATES, PRICING_YEARLY_AS
} from '../shared/pricing'

// The native editor hand-ports the pricing limits and choices; this keeps the
// copies in step with shared/pricing.ts (and the AI focus of server/utils/pricingAi.ts).

const file = join(import.meta.dir, '../helpbites-native/App/Features/Pricing/PricingModels.swift')
const swift = existsSync(file) ? readFileSync(file, 'utf8') : ''
const limits = swift.slice(swift.indexOf('enum PricingLimits'), swift.indexOf('enum PricingCell'))
// Server code needs Nitro's globals to load, so its list is read from the source.
const aiFocus = [...(readFileSync(join(import.meta.dir, '../server/utils/pricingAi.ts'), 'utf8').match(/PRICING_AI_FOCUS = \[([^\]]*)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map(m => m[1]!)

/** `static let name = 1_000` in PricingLimits, as a number. */
function constant(name: string): number | null {
  const match = limits.match(new RegExp(`static let ${name} = ([\\d_]+)\\b`))
  return match ? Number(match[1]!.replaceAll('_', '')) : null
}

/** The ids of a `static let name: [(id: String, …)] = [("a", …), …]` list, in order. */
function ids(name: string): string[] {
  const start = limits.indexOf(`static let ${name}:`)
  if (start < 0) return []
  const end = limits.indexOf('\n  static', start + 1)
  return [...limits.slice(start, end < 0 ? undefined : end).matchAll(/\("([a-z_]+)",/g)].map(m => m[1]!)
}

/** A `static let name = ["a", "b"]` list of strings. */
function strings(name: string): string[] {
  const match = limits.match(new RegExp(`static let ${name} = \\[([^\\]]*)\\]`))
  return match ? [...match[1]!.matchAll(/"([^"]+)"/g)].map(m => m[1]!) : []
}

describe('native pricing parity', () => {
  test('PricingModels.swift exists', () => {
    expect(existsSync(file)).toBe(true)
  })

  test('every limit has the same value', () => {
    const differ = Object.entries(PRICING_LIMITS).filter(([name, value]) => constant(name) !== value).map(([name, value]) => `${name}: ${value} vs ${constant(name)}`)
    expect(differ).toEqual([])
    expect(constant('locales')).toBe(PRICING_MAX_LOCALES)
    expect(constant('maxVariants')).toBe(PRICING_MAX_VARIANTS)
  })

  test('the key pattern is the same', () => {
    expect(limits).toContain(`static let key = "${PRICING_KEY.source}"`)
  })

  test('the choices are the same, in the same order', () => {
    expect(ids('templates')).toEqual([...PRICING_TEMPLATES])
    expect(ids('intervals')).toEqual([...PRICING_INTERVALS])
    expect(strings('recurring')).toEqual([...PRICING_RECURRING])
    expect(ids('actions')).toEqual([...PRICING_ACTIONS])
    expect(ids('fonts')).toEqual([...PRICING_FONTS])
    expect(ids('densities')).toEqual([...PRICING_DENSITIES])
    expect(ids('surfaces')).toEqual([...PRICING_SURFACES])
    expect(ids('highlights')).toEqual([...PRICING_HIGHLIGHTS])
    expect(ids('yearlyAs')).toEqual([...PRICING_YEARLY_AS])
    expect(aiFocus.length).toBeGreaterThan(0)
    expect(ids('focus')).toEqual(aiFocus)
  })
})
