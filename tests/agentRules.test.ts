import { describe, expect, test } from 'bun:test'
import { matchAgentRules, normalizeAgentRules, type AgentRule } from '../shared/knowledge'

describe('matchAgentRules', () => {
  const billingHuman: AgentRule = { conversationType: 'billing', action: 'human' }
  const refundHuman: AgentRule = { keywords: ['refund', 'chargeback'], action: 'human' }

  test('first matching rule wins, else defaultAction', () => {
    const rules = [billingHuman, refundHuman]
    // type match
    expect(matchAgentRules(rules, { conversationType: 'billing', text: 'anything' }, 'auto')).toBe('human')
    // keyword match (case-insensitive substring)
    expect(matchAgentRules(rules, { conversationType: 'support', text: 'I want a REFUND now' }, 'auto')).toBe('human')
    // no rule matches → default
    expect(matchAgentRules(rules, { conversationType: 'support', text: 'how do I export?' }, 'auto')).toBe('auto')
    expect(matchAgentRules(rules, { conversationType: 'support', text: 'how do I export?' }, 'human')).toBe('human')
  })

  test('a rule with both conditions needs both to hold', () => {
    const rules: AgentRule[] = [{ conversationType: 'support', keywords: ['bug'], action: 'human' }]
    expect(matchAgentRules(rules, { conversationType: 'support', text: 'found a bug' }, 'auto')).toBe('human')
    expect(matchAgentRules(rules, { conversationType: 'billing', text: 'found a bug' }, 'auto')).toBe('auto') // wrong type
    expect(matchAgentRules(rules, { conversationType: 'support', text: 'a question' }, 'auto')).toBe('auto') // no keyword
  })

  test('empty rules fall through to the default', () => {
    expect(matchAgentRules([], { conversationType: 'support', text: 'hi' }, 'auto')).toBe('auto')
  })
})

describe('normalizeAgentRules', () => {
  test('drops condition-less rules and coerces the action', () => {
    const out = normalizeAgentRules([
      { action: 'human' },                                   // no condition → dropped
      { conversationType: 'billing', action: 'nonsense' },   // bad action → 'auto'
      { keywords: ['refund', '', 'refund'], action: 'human' } // trims/dedupes empties
    ])
    expect(out).toEqual([
      { action: 'auto', conversationType: 'billing' },
      { action: 'human', keywords: ['refund'] }
    ])
  })

  test('non-arrays become an empty list', () => {
    expect(normalizeAgentRules(undefined)).toEqual([])
    expect(normalizeAgentRules('nope')).toEqual([])
  })
})
