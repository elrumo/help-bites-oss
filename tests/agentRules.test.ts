import { describe, expect, test } from 'bun:test'
import { assistantReadiness, decideAgentReply, describeHandoff, judgeKnowledge, matchAgentRules, normalizeAgentRules, routeAgentMessage, type AgentRule } from '../shared/knowledge'

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

describe('why an assistant answers or hands over', () => {
  const settings = { rules: [{ conversationType: 'billing', action: 'human' }, { keywords: ['refund'], action: 'human' }, { keywords: ['export'], action: 'auto' }] as AgentRule[], defaultAction: 'auto' as const, minConfidence: 0.5, fallbackBehavior: 'human' as const }
  const support = (text: string) => ({ conversationType: 'support', text })

  test('the first rule that matches decides, and the test can say which', () => {
    expect(routeAgentMessage(settings.rules, { conversationType: 'billing', text: 'hi' }, 'auto')).toEqual({ action: 'human', reason: 'rule', ruleIndex: 0 })
    expect(routeAgentMessage(settings.rules, support('a REFUND please'), 'auto')).toEqual({ action: 'human', reason: 'rule', ruleIndex: 1 })
    expect(routeAgentMessage(settings.rules, support('how to export?'), 'human')).toEqual({ action: 'auto', reason: 'rule', ruleIndex: 2 })
    expect(routeAgentMessage(settings.rules, support('hello'), 'human')).toEqual({ action: 'human', reason: 'default', ruleIndex: null })
    expect(routeAgentMessage([], support('hello'), 'auto')).toEqual({ action: 'auto', reason: 'default', ruleIndex: null })
  })

  test('matching still agrees with the routing it was split from', () => {
    for (const text of ['refund', 'export', 'nothing', 'refund export']) {
      expect(matchAgentRules(settings.rules, support(text), 'human')).toBe(routeAgentMessage(settings.rules, support(text), 'human').action)
    }
  })

  test('knowledge answers only when something matched well enough', () => {
    expect(judgeKnowledge([0.2, 0.8], 0.5, 'human')).toMatchObject({ outcome: 'answer', reason: 'confident', best: 0.8 })
    expect(judgeKnowledge([0.2, 0.4], 0.5, 'human')).toMatchObject({ outcome: 'handoff', reason: 'lowConfidence', best: 0.4 })
    expect(judgeKnowledge([], 0.5, 'human')).toMatchObject({ outcome: 'handoff', reason: 'noKnowledge' })
    expect(judgeKnowledge([0.1], 0, 'human')).toMatchObject({ outcome: 'answer' })
  })

  test('"stay silent" keeps the team out of an unsure answer, but a rule still hands over', () => {
    expect(judgeKnowledge([], 0.5, 'silent')).toMatchObject({ outcome: 'silent', reason: 'noKnowledge' })
    expect(decideAgentReply({ ...settings, fallbackBehavior: 'silent' }, support('refund'), [0.9])).toMatchObject({ outcome: 'handoff', reason: 'rule', ruleIndex: 1 })
  })

  test('both steps together: a rule hands over before knowledge is read, a pass goes on to it', () => {
    expect(decideAgentReply(settings, support('refund'), [0.9])).toMatchObject({ outcome: 'handoff', reason: 'rule', ruleIndex: 1, best: 0 })
    expect(decideAgentReply(settings, support('how to export?'), [0.9])).toMatchObject({ outcome: 'answer', reason: 'confident', ruleIndex: 2 })
    expect(decideAgentReply(settings, support('how to export?'), [0.1])).toMatchObject({ outcome: 'handoff', reason: 'lowConfidence', ruleIndex: 2 })
    expect(decideAgentReply({ ...settings, defaultAction: 'human' }, support('hello'), [0.9])).toMatchObject({ outcome: 'handoff', reason: 'default' })
  })

  test('the note left for the team says why', () => {
    expect(describeHandoff({ reason: 'rule', minConfidence: 0 })).toBe('a rule sends messages like this one to the team')
    expect(describeHandoff({ reason: 'noKnowledge', minConfidence: 0.5 })).toBe('no knowledge matched the question')
    expect(describeHandoff({ reason: 'lowConfidence', minConfidence: 0.55 })).toBe('no knowledge matched with at least 55% confidence')
  })
})

describe('assistant readiness', () => {
  const keys = (r: ReturnType<typeof assistantReadiness>) => r.checks.filter(c => !c.ok).map(c => c.key)

  test('it needs a provider, knowledge to read, an active status and auto-reply, in that order', () => {
    expect(keys(assistantReadiness({ status: 'draft', autoReply: false, llm: false, faqs: 0 }))).toEqual(['llm', 'knowledge', 'active', 'autoReply'])
    expect(keys(assistantReadiness({ status: 'active', autoReply: true, llm: true, faqs: 3 }))).toEqual([])
  })

  test('a test answer works before it goes live; live needs all four', () => {
    expect(assistantReadiness({ status: 'draft', autoReply: false, llm: true, faqs: 2 })).toMatchObject({ canAnswer: true, live: false })
    expect(assistantReadiness({ status: 'active', autoReply: true, llm: true, faqs: 0 })).toMatchObject({ canAnswer: false, live: false })
    expect(assistantReadiness({ status: 'active', autoReply: true, llm: true, faqs: 2 })).toMatchObject({ canAnswer: true, live: true, faqs: 2 })
  })
})
