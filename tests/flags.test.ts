import { describe, expect, test } from 'bun:test'
import { flagEnabledFor, flagsForTarget, normalizeFlags, validateFlags, type FeatureFlag } from '../shared/flags'

const flag = (over: Partial<FeatureFlag> = {}): FeatureFlag => ({ key: 'f', description: '', state: 'off', fallback: 'off', targets: [], allow: [], ...over })

describe('validation', () => {
  test('fills defaults: fallback is off unless set', () => {
    const { flags, errors } = validateFlags([{ key: 'ai_chat', state: 'admins', targets: ['Frontend', 'frontend', 'backend'], allow: [' Ada@Example.com ', 'u_1', 'u_1'] }])
    expect(errors).toEqual([])
    expect(flags).toEqual([{ key: 'ai_chat', description: '', state: 'admins', fallback: 'off', targets: ['frontend', 'backend'], allow: ['ada@example.com', 'u_1'] }])
  })

  test('reports bad keys, duplicates, states and targets instead of dropping them silently', () => {
    const { errors } = validateFlags([{ key: 'Bad Key' }, { key: 'a' }, { key: 'a' }, { key: 'b', state: 'maybe', fallback: 1 }, { key: 'c', targets: ['front end'] }])
    expect(errors).toHaveLength(5)
  })

  test('a non-list is an error; stored garbage reads as no flags', () => {
    expect(validateFlags({}).errors).toHaveLength(1)
    expect(normalizeFlags('nonsense')).toEqual([])
  })
})

describe('evaluation', () => {
  const nobody = { isAdmin: false }
  test('off is off for admins too; on is on for everyone', () => {
    expect(flagEnabledFor('off', flag(), { isAdmin: true })).toBe(false)
    expect(flagEnabledFor('on', flag(), nobody)).toBe(true)
  })

  test('admins: the host admin, or the allow list by sub or email', () => {
    const f = flag({ allow: ['u_1', 'ada@example.com'] })
    expect(flagEnabledFor('admins', f, { isAdmin: true })).toBe(true)
    expect(flagEnabledFor('admins', f, nobody)).toBe(false)
    expect(flagEnabledFor('admins', f, { isAdmin: false, sub: 'u_1' })).toBe(true)
    expect(flagEnabledFor('admins', f, { isAdmin: false, sub: 'u_2', email: 'Ada@Example.com' })).toBe(true)
    expect(flagEnabledFor('admins', f, { isAdmin: false, sub: 'u_2', email: 'bob@example.com' })).toBe(false)
  })

  test('targets: untagged flags go to everyone, tagged ones only to their target', () => {
    const flags = [flag({ key: 'all' }), flag({ key: 'fe', targets: ['frontend'] }), flag({ key: 'be', targets: ['backend'] })]
    expect(flagsForTarget(flags, 'frontend').map(f => f.key)).toEqual(['all', 'fe'])
    expect(flagsForTarget(flags, '').map(f => f.key)).toEqual(['all', 'fe', 'be'])
  })
})
