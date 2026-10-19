import { describe, expect, test } from 'bun:test'
import { LEGAL_CLAUSES } from '../shared/legal/clauses'
import {
  aiTldr, applicableRequirements, requirementId, applySectionEdits, canReplaceTldr, checkCoverage, composeDocument, composeVariables, extractJson, fillTemplate, humanTldr, mergeRecomposed, sanitizeFindings, sectionsToMarkdown
} from '../shared/legal/compose'
import { LEGAL_RULEPACKS } from '../shared/legal/rulepacks'
import { LEGAL_DOC_TYPES, LEGAL_REGIONS, type LegalAnswers } from '../shared/legal/types'
import { matches } from '../shared/legal/when'
import { questionsFor, validateAnswers } from '../shared/legal/wizard'

// Everything switched on: every region, every data kind, every optional clause.
const EVERYTHING: LegalAnswers = {
  app_name: 'Acme Notes', entity_name: 'Acme Ltd', entity_address: '1 High St, London', contact_email: 'legal@acme.test', website_url: 'https://acme.test',
  dpo_contact: 'dpo@acme.test', platforms: ['ios', 'android', 'web', 'desktop'], regions: [...LEGAL_REGIONS],
  data_collected: ['account', 'payments', 'analytics', 'crash', 'device', 'location', 'user_content', 'support', 'advertising'],
  processors: ['stripe', 'firebase', 'sentry', 'openai'], sells_or_shares_data: true, ai_features: true, children: 'teens', retention: 'until you delete your account',
  cookie_types: ['essential', 'preferences', 'analytics', 'advertising'], subscriptions: true, min_age: '16', governing_law: 'England and Wales',
  refund_via: 'direct', refund_window_days: '30'
}

describe('matches', () => {
  test('no condition always holds', () => expect(matches(undefined, {})).toBe(true))
  test('no regions answered counts as row', () => {
    expect(matches({ regions: ['row'] }, {})).toBe(true)
    expect(matches({ regions: ['eu'] }, {})).toBe(false)
  })
  test('has needs an overlap; is treats an unanswered boolean as false', () => {
    expect(matches({ has: { platforms: ['ios'] } }, { platforms: ['web', 'ios'] })).toBe(true)
    expect(matches({ has: { platforms: ['ios'] } }, { platforms: ['web'] })).toBe(false)
    expect(matches({ is: { ai_features: false } }, {})).toBe(true)
    expect(matches({ is: { ai_features: true } }, {})).toBe(false)
  })
  test('anyOf holds when one member does, and combines with the rest by AND', () => {
    const when = { regions: ['eu'], anyOf: [{ is: { children: 'kids' } }, { is: { children: 'teens' } }] }
    expect(matches(when, { regions: ['eu'], children: 'teens' })).toBe(true)
    expect(matches(when, { regions: ['eu'], children: 'none' })).toBe(false)
    expect(matches(when, { regions: ['uk'], children: 'teens' })).toBe(false)
  })
})

describe('wizard', () => {
  test('drops unknown keys and values that are not options, and trims text', () => {
    const { answers } = validateAnswers('privacy', { app_name: '  Acme ', evil: 'x', regions: ['eu', 'mars'], children: 'robots', ai_features: 'yes' })
    expect(answers).toEqual({ app_name: 'Acme', regions: ['eu'] })
  })
  test('reports visible required questions only', () => {
    const { errors } = validateAnswers('terms', {})
    expect(errors.some(e => e.includes('Governing law'))).toBe(true)
    expect(validateAnswers('privacy', {}).errors.some(e => e.includes('Governing law'))).toBe(false)
  })
  test('every question id is unique per document type', () => {
    for (const type of LEGAL_DOC_TYPES) {
      const ids = questionsFor(type).map(q => q.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('library integrity', () => {
  const requirementIds = new Set(LEGAL_RULEPACKS.flatMap(p => p.requirements.map(r => r.id)))
  test('requirement ids are unique', () => {
    const all = LEGAL_RULEPACKS.flatMap(p => p.requirements.map(r => r.id))
    expect(new Set(all).size).toBe(all.length)
  })
  test('every satisfies id names a real requirement', () => {
    for (const clause of LEGAL_CLAUSES) for (const id of clause.satisfies || []) expect(requirementIds.has(id)).toBe(true)
  })
  test('clause ids are unique', () => {
    expect(new Set(LEGAL_CLAUSES.map(c => c.id)).size).toBe(LEGAL_CLAUSES.length)
  })
  test('every clause placeholder is a variable the composer fills', () => {
    const known = new Set(Object.keys(composeVariables({})))
    for (const clause of LEGAL_CLAUSES) {
      for (const match of clause.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) expect(known.has(match[1]!)).toBe(true)
    }
  })
})

describe('composeDocument', () => {
  test('with everything on, every requirement of every document type is covered', () => {
    for (const type of LEGAL_DOC_TYPES) {
      const { sections } = composeDocument(type, EVERYTHING)
      const coverage = checkCoverage(type, EVERYTHING, sections)
      expect(coverage.gaps.map(g => g.id)).toEqual([])
      expect(coverage.total).toBeGreaterThan(0)
    }
  })
  test('the other children answers are covered too', () => {
    for (const children of ['none', 'kids']) {
      const answers = { ...EVERYTHING, children, sells_or_shares_data: false }
      const { sections } = composeDocument('privacy', answers)
      expect(checkCoverage('privacy', answers, sections).gaps.map(g => g.id)).toEqual([])
    }
  })
  test('a minimal answer set leaves out region clauses and still covers what applies', () => {
    const answers = { app_name: 'Tiny', entity_name: 'Me', contact_email: 'me@tiny.test', children: 'none' }
    const { sections } = composeDocument('privacy', answers)
    const ids = sections.map(s => s.id)
    expect(ids).not.toContain('privacy.rights-eu')
    expect(ids).toContain('privacy.collect')
    expect(checkCoverage('privacy', answers, sections).gaps).toEqual([])
  })
  test('removing a section shows up as a gap', () => {
    const { sections } = composeDocument('privacy', EVERYTHING)
    const without = sections.filter(s => s.id !== 'privacy.transfers')
    const gaps = checkCoverage('privacy', EVERYTHING, without).gaps.map(g => g.id)
    expect(gaps).toContain('gdpr-13-1f')
    expect(gaps).toContain('lgpd-33-transfers')
  })
  test('an emptied section no longer covers its requirements', () => {
    const { sections } = composeDocument('privacy', EVERYTHING)
    const emptied = sections.map(s => (s.id === 'privacy.retention' ? { ...s, body: '  ' } : s))
    expect(checkCoverage('privacy', EVERYTHING, emptied).gaps.map(g => g.id)).toContain('gdpr-13-2a')
  })
  test('conditional requirements only apply when their condition holds', () => {
    const noSale = applicableRequirements('privacy', { ...EVERYTHING, sells_or_shares_data: false }).map(r => r.id)
    const sale = applicableRequirements('privacy', EVERYTHING).map(r => r.id)
    expect(noSale).not.toContain('ccpa-opt-out')
    expect(sale).toContain('ccpa-opt-out')
  })
  test('packs are all unreviewed until a person sets a date', () => {
    const { sections } = composeDocument('privacy', EVERYTHING)
    expect(checkCoverage('privacy', EVERYTHING, sections).unreviewedPacks).toContain('gdpr')
  })
  test('fills variables and lists the chosen services', () => {
    const { sections } = composeDocument('privacy', EVERYTHING)
    const text = sectionsToMarkdown(sections)
    expect(text).toContain('Acme Notes is operated by Acme Ltd, 1 High St, London')
    expect(text).toContain('[Privacy policy](https://stripe.com/privacy)')
    expect(text).toContain('dpo@acme.test')
    expect(text).not.toContain('{{')
  })
  test('fillTemplate blanks an unknown variable', () => expect(fillTemplate('a{{nope}}b', {})).toBe('ab'))
})

describe('mergeRecomposed', () => {
  const base = () => composeDocument('privacy', EVERYTHING).sections

  test('keeps edited, locked and AI sections; refreshes the rest', () => {
    const existing = base().map((s) => {
      if (s.id === 'privacy.who') return { ...s, body: 'Hand written', source: 'human' as const }
      if (s.id === 'privacy.use') return { ...s, body: 'Pinned', locked: true }
      if (s.id === 'privacy.security') return { ...s, body: 'AI text', source: 'ai' as const }
      if (s.id === 'privacy.retention') return { ...s, body: 'stale' }
      return s
    })
    const fresh = composeDocument('privacy', { ...EVERYTHING, retention: 'forever' }).sections
    const merged = mergeRecomposed(existing, fresh)
    const get = (id: string) => merged.find(s => s.id === id)!
    expect(get('privacy.who').body).toBe('Hand written')
    expect(get('privacy.use').body).toBe('Pinned')
    expect(get('privacy.security').body).toBe('AI text')
    expect(get('privacy.retention').body).toContain('forever')
  })
  test('drops template sections whose clause stopped applying, keeps hand-added ones, adds new clauses in place', () => {
    const existing = [...base(), { id: 's_custom', heading: 'Mine', body: 'x', source: 'human' as const, locked: false, satisfies: [] }]
    const answers = { ...EVERYTHING, regions: ['row'] }
    const merged = mergeRecomposed(existing, composeDocument('privacy', answers).sections)
    expect(merged.some(s => s.id === 'privacy.rights-eu')).toBe(false)
    expect(merged.some(s => s.id === 's_custom')).toBe(true)

    // And back: a region added again brings its clause back next to its neighbours.
    const back = mergeRecomposed(merged, composeDocument('privacy', EVERYTHING).sections)
    const ids = back.map(s => s.id)
    expect(ids).toContain('privacy.rights-eu')
    expect(ids.indexOf('privacy.rights-eu')).toBeGreaterThan(ids.indexOf('privacy.rights'))
  })
})

describe('applySectionEdits', () => {
  const sections = composeDocument('terms', EVERYTHING).sections
  test('an unchanged template section stays template; a changed one becomes human', () => {
    const first = sections[0]!
    const out = applySectionEdits(sections, sections.map(s => (s.id === first.id ? { id: s.id, body: 'changed' } : { id: s.id, body: s.body })))
    expect(out[0]!.source).toBe('human')
    expect(out[1]!.source).toBe('template')
  })
  test('a new id becomes a human section and an omitted one is removed', () => {
    const out = applySectionEdits(sections, [{ id: sections[0]!.id }, { heading: 'Extra', body: 'text' }])
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ heading: 'Extra', source: 'human', satisfies: [] })
  })
})

describe('AI guards', () => {
  test('sanitizeFindings drops invented requirement ids, bad statuses and repeats', () => {
    const allowed = new Set(['gdpr-13-1a', 'gdpr-13-2a'])
    const findings = sanitizeFindings([
      { requirement: 'gdpr-13-1a', status: 'missing', note: 'No controller named.' },
      { requirement: 'gdpr-13-1a', status: 'ok', note: 'dupe' },
      { requirement: 'made-up-99', status: 'missing', note: 'invented' },
      { requirement: 'gdpr-13-2a', status: 'great', note: 'bad status' },
      'junk'
    ], allowed)
    expect(findings).toEqual([{ requirement: 'gdpr-13-1a', status: 'missing', note: 'No controller named.' }])
    expect(sanitizeFindings({ not: 'an array' }, allowed)).toEqual([])
    expect(sanitizeFindings([{ requirement: '[R:gdpr-13-2a]', status: 'ok', note: 'x' }], allowed)).toEqual([{ requirement: 'gdpr-13-2a', status: 'ok', note: 'x' }])
  })
  test('requirementId accepts the forms a model echoes back', () => {
    for (const form of ['gdpr-13-1a', 'R:gdpr-13-1a', '[R:gdpr-13-1a]', ' r:gdpr-13-1a ']) expect(requirementId(form)).toBe('gdpr-13-1a')
    expect(requirementId(42)).toBe('')
  })
  test('extractJson finds JSON inside prose or a fence', () => {
    expect(extractJson('Here you go:\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }])
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('[broken')).toBeNull()
    // A reply cut off by the token limit keeps the objects that were finished.
    expect(extractJson('[{"a":1},{"a":2},{"a":')).toEqual([{ a: 1 }, { a: 2 }])
    expect(extractJson('[{"a":1},{"a":2},{"a":3}]')).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
  test('AI may not overwrite a human TL;DR unless forced', () => {
    expect(canReplaceTldr(null)).toBe(true)
    expect(canReplaceTldr(aiTldr('x'))).toBe(true)
    expect(canReplaceTldr(humanTldr('mine'))).toBe(false)
    expect(canReplaceTldr(humanTldr('mine'), true)).toBe(true)
    expect(humanTldr('  hi ').source).toBe('human')
  })
})
