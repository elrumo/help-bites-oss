import { describe, expect, test } from 'bun:test'
import { resolveAgentFaqFilter, faqAllowed, filterIsEmpty, rankAndFilter, type FaqLite } from '../shared/knowledge'

const faq = (id: string, modelId: string, pathCache: string, extra: Partial<FaqLite> = {}): FaqLite =>
  ({ id, modelId, pathCache, status: 'active', ...extra })

describe('agent knowledge assignment resolution', () => {
  test('a whole-model assignment grants every FAQ in that model only', () => {
    const filter = resolveAgentFaqFilter([{ scope: 'model', modelId: 'm1' }])
    expect(faqAllowed(faq('a', 'm1', 'Account'), filter)).toBe(true)
    expect(faqAllowed(faq('b', 'm2', 'Account'), filter)).toBe(false)
  })

  test('a path assignment grants the whole subtree (inheritance)', () => {
    const filter = resolveAgentFaqFilter([{ scope: 'path', modelId: 'm1', pathCache: 'Account' }])
    expect(faqAllowed(faq('a', 'm1', 'Account'), filter)).toBe(true)
    expect(faqAllowed(faq('b', 'm1', 'Account/Subscription'), filter)).toBe(true)
    expect(faqAllowed(faq('c', 'm1', 'Billing'), filter)).toBe(false)
    // "Accountant" must not match the "Account" prefix.
    expect(faqAllowed(faq('d', 'm1', 'Accountant'), filter)).toBe(false)
  })

  test('an exclusion overrides a broader grant', () => {
    const filter = resolveAgentFaqFilter([
      { scope: 'model', modelId: 'm1' },
      { scope: 'path', modelId: 'm1', pathCache: 'Billing', exclude: true },
      { scope: 'faq', faqId: 'secret', exclude: true }
    ])
    expect(faqAllowed(faq('a', 'm1', 'Account'), filter)).toBe(true)
    expect(faqAllowed(faq('b', 'm1', 'Billing/Invoices'), filter)).toBe(false)
    expect(faqAllowed(faq('secret', 'm1', 'Account'), filter)).toBe(false)
  })

  test('an individual-FAQ assignment grants exactly that FAQ', () => {
    const filter = resolveAgentFaqFilter([{ scope: 'faq', faqId: 'only-this' }])
    expect(faqAllowed(faq('only-this', 'm9', 'Whatever'), filter)).toBe(true)
    expect(faqAllowed(faq('other', 'm9', 'Whatever'), filter)).toBe(false)
  })

  test('no assignments ⇒ empty filter ⇒ nothing allowed', () => {
    const filter = resolveAgentFaqFilter([])
    expect(filterIsEmpty(filter)).toBe(true)
    expect(faqAllowed(faq('a', 'm1', 'Account'), filter)).toBe(false)
  })
})

describe('rankAndFilter', () => {
  const rows = [
    { id: '1', status: 'active', language: 'en' },
    { id: '2', status: 'disabled', language: 'en' },
    { id: '3', status: 'active', language: 'es' }
  ]
  test('keeps only active by default and preserves order', () => {
    expect(rankAndFilter(rows).map(r => r.id)).toEqual(['1', '3'])
  })
  test('filters by language and respects the limit', () => {
    expect(rankAndFilter(rows, { language: 'en' }).map(r => r.id)).toEqual(['1'])
    expect(rankAndFilter(rows, { statuses: ['active', 'disabled'], limit: 2 }).map(r => r.id)).toEqual(['1', '2'])
  })
})
