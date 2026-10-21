import { describe, expect, test } from 'bun:test'
import { compileSegmentFilter, segmentRelationsNeeded, validateSegmentFilter } from '../shared/segments'

const now = new Date('2026-10-01T00:00:00.000Z')
const compile = (filter: unknown) => {
  const { filter: clean, errors } = validateSegmentFilter(filter)
  expect(errors).toEqual([])
  return compileSegmentFilter(clean, now)
}

describe('segments', () => {
  test('no rules matches everyone', () => {
    expect(compile({})).toEqual({})
    expect(compile({ match: 'all', rules: [] })).toEqual({})
  })

  test('rules compile to a Parse where, all with $and and any with $or', () => {
    expect(compile({ rules: [{ field: 'email', op: 'is', value: 'Ada@Example.com' }] })).toEqual({ email: 'ada@example.com' })
    expect(compile({ match: 'all', rules: [{ field: 'tags', op: 'includes', value: 'beta' }, { field: 'subscription', op: 'is', value: 'subscribed' }] }))
      .toEqual({ $and: [{ tags: 'beta' }, { subscription: 'subscribed' }] })
    expect(compile({ match: 'any', rules: [{ field: 'name', op: 'contains', value: 'a.b' }, { field: 'tags', op: 'excludes', value: 'vip' }] }))
      .toEqual({ $or: [{ name: { $regex: 'a\\.b', $options: 'i' } }, { tags: { $ne: 'vip' } }] })
  })

  test('dates on the row are Parse dates; "not in the last N days" includes never', () => {
    expect(compile({ rules: [{ field: 'lastSeenAt', op: 'within_days', value: 30 }] })).toEqual({ lastSeenAt: { $gte: { __type: 'Date', iso: '2026-09-01T00:00:00.000Z' } } })
    expect(compile({ rules: [{ field: 'lastSeenAt', op: 'not_within_days', value: 1 }] }))
      .toEqual({ $or: [{ lastSeenAt: { $lt: { __type: 'Date', iso: '2026-09-30T00:00:00.000Z' } } }, { lastSeenAt: { $exists: false } }] })
    expect(compile({ rules: [{ field: 'createdAt', op: 'after', value: '2026-01-01' }] })).toEqual({ createdAt: { $gt: { __type: 'Date', iso: '2026-01-01T00:00:00.000Z' } } })
  })

  test('attributes match a typed-in value whatever type it was stored as', () => {
    expect(compile({ rules: [{ field: 'attributes.seats', op: 'is', value: '3' }] })).toEqual({ 'attributes.seats': { $in: ['3', 3] } })
    expect(compile({ rules: [{ field: 'attributes.trial', op: 'is_not', value: 'true' }] })).toEqual({ 'attributes.trial': { $nin: ['true', true] } })
    expect(compile({ rules: [{ field: 'attributes.mrr', op: 'gt', value: 10 }] })).toEqual({ 'attributes.mrr': { $gt: 10 } })
    expect(compile({ rules: [{ field: 'attributes.renewsAt', op: 'before', value: '2026-12-01' }] })).toEqual({ 'attributes.renewsAt': { $lt: '2026-12-01T00:00:00.000Z' } })
  })

  test('nothing but plain values gets through: no operators, no unknown fields', () => {
    expect(validateSegmentFilter({ rules: [{ field: 'email', op: 'is', value: { $ne: null } }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: [{ field: '$where', op: 'is', value: 'x' }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: [{ field: 'attributes.a.b', op: 'is', value: 'x' }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: [{ field: 'attributes.$gt', op: 'is', value: 'x' }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: [{ field: 'subscription', op: 'contains', value: 'sub' }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: [{ field: 'subscription', op: 'is', value: 'everyone' }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: [{ field: 'lastSeenAt', op: 'within_days', value: -2 }] }).errors).toHaveLength(1)
    expect(validateSegmentFilter({ rules: Array.from({ length: 21 }, () => ({ field: 'tags', op: 'exists' })) }).errors).toHaveLength(1)
  })

  test('a regex value is escaped, not interpreted', () => {
    expect(compile({ rules: [{ field: 'email', op: 'starts_with', value: '.*' }] })).toEqual({ email: { $regex: '^\\.\\*', $options: 'i' } })
  })
})

describe('relation and built-in fields', () => {
  const rule = (field: string, op: string, value?: unknown) => ({ match: 'all' as const, rules: [{ field, op, value }] })

  test('the Stripe plan reads the attribute the Stripe sync keeps', () => {
    const { filter, errors } = validateSegmentFilter(rule('stripePlan', 'is', 'Pro'))
    expect(errors).toEqual([])
    expect(compileSegmentFilter(filter)).toEqual({ 'attributes.stripe_plan': 'Pro' })
    expect(compileSegmentFilter(validateSegmentFilter(rule('stripePlan', 'not_exists')).filter)).toEqual({ 'attributes.stripe_plan': { $exists: false } })
  })

  test('yes/no fields only take yes or no, and booleans are accepted', () => {
    expect(validateSegmentFilter(rule('hasErrors', 'is', 'maybe')).errors).toHaveLength(1)
    expect(validateSegmentFilter(rule('hasErrors', 'contains', 'yes')).errors).toHaveLength(1)
    expect(validateSegmentFilter(rule('hasErrors', 'is', true)).filter.rules[0]).toEqual({ field: 'hasErrors', op: 'is', value: 'yes' })
  })

  test('a relation compiles to the ids looked up for it, and refuses to compile without them', () => {
    const filter = validateSegmentFilter({ match: 'all', rules: [{ field: 'hasOpenConversation', op: 'is', value: 'yes' }, { field: 'votedOnPost', op: 'is', value: 'no' }] }).filter
    expect(segmentRelationsNeeded(filter)).toEqual(['hasOpenConversation', 'votedOnPost'])
    expect(() => compileSegmentFilter(filter)).toThrow('looked up')
    expect(compileSegmentFilter(filter, new Date(), { hasOpenConversation: ['a', 'b'], votedOnPost: ['c'] })).toEqual({ $and: [{ objectId: { $in: ['a', 'b'] } }, { objectId: { $nin: ['c'] } }] })
    expect(compileSegmentFilter(validateSegmentFilter(rule('finishedOnboarding', 'is', 'yes')).filter, new Date(), { finishedOnboarding: [] })).toEqual({ objectId: { $in: [] } })
  })
})
