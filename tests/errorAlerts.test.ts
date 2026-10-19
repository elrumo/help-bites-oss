import { expect, test } from 'bun:test'
import { eventsInWindow, normalizeErrorAlerts, triggeredRules } from '#shared/errorAlerts'
import { errorDetailOf, flattenEvent } from '#shared/errors'

const MIN = 60_000
const rules = normalizeErrorAlerts({ rules: [{ id: 'n', kind: 'new' }, { id: 't', kind: 'total', threshold: 100 }, { id: 'r', kind: 'rate', threshold: 5, windowMinutes: 10, link: 'main' }], emails: ['A@x.io', 'a@x.io'] }).config.rules
const fresh = { samples: [], seenBefore: true, lastFired: {} }
const ids = (list: ReturnType<typeof triggeredRules>) => list.map(rule => rule.id)

test('rules are cleaned on the way in', () => {
  const { config, errors } = normalizeErrorAlerts({ rules: [{ kind: 'bogus', threshold: -4 }, { kind: 'rate', threshold: 3, windowMinutes: 0 }], emails: ['A@x.io', 'a@x.io', 'nope'] })
  expect(errors).toEqual(['Rule 1: unknown kind', '"nope" is not an email address'])
  expect(config.rules.map(rule => [rule.kind, rule.threshold, rule.windowMinutes])).toEqual([['total', 1, 0], ['rate', 3, 1]])
  expect(config.emails).toEqual(['a@x.io'])
})

test('a rate counts events since the window opened, and only fires for the rule\'s own tracker project', () => {
  const now = 100 * MIN
  const samples: Array<[number, number]> = [[now - 30 * MIN, 50], [now - 12 * MIN, 52], [now - 5 * MIN, 55]]
  expect(eventsInWindow(samples, 58, now, 10)).toBe(6)
  expect(eventsInWindow([], 58, now, 10)).toBe(0)
  expect(ids(triggeredRules(rules, { linkId: 'main', count: 58 }, { ...fresh, samples }, now))).toEqual(['r'])
  expect(ids(triggeredRules(rules, { linkId: 'other', count: 58 }, { ...fresh, samples }, now))).toEqual([])
})

test('total and new fire once, then wait out their cooldown', () => {
  const now = 10_000 * MIN
  expect(ids(triggeredRules(rules, { linkId: 'main', count: 100 }, { ...fresh, seenBefore: false }, now))).toEqual(['n', 't'])
  expect(ids(triggeredRules(rules, { linkId: 'main', count: 900 }, { ...fresh, lastFired: { t: now - 60 * MIN } }, now))).toEqual([])
  expect(ids(triggeredRules(rules, { linkId: 'main', count: 900 }, { ...fresh, lastFired: { t: now - 25 * 60 * MIN } }, now))).toEqual(['t'])
})

test('both trackers\' events boil down to the same detail', () => {
  const sentry = { exception: { values: [{ type: 'TypeError', value: 'x', stacktrace: { frames: [{ filename: 'lib.js', lineno: 1, function: 'a' }, { filename: 'app.ts', lineno: 7, function: 'b', in_app: true, context_line: 'boom()', pre_context: ['a', 'b'] }] } }] }, tags: { env: 'prod' }, request: { method: 'GET', url: '/x' } }
  const glitch = { entries: [{ type: 'exception', data: { values: [{ type: 'TypeError', value: 'x', stacktrace: { frames: [{ filename: 'app.ts', lineNo: 7, function: 'b', inApp: true, context: [[6, 'a'], [7, 'boom()']] }] } }] } }], tags: [{ key: 'env', value: 'prod' }] }
  const a = errorDetailOf({ digested_event_count: 3, is_muted: true }, sentry)
  expect(a.issue).toMatchObject({ status: 'ignored', count: 3 })
  expect(a.frames.map(frame => frame.file)).toEqual(['app.ts', 'lib.js'])
  expect(a.frames[0]).toMatchObject({ inApp: true, context: 'boom()', before: ['a', 'b'] })
  expect(a.tags).toEqual([['env', 'prod']])
  expect(a.details).toEqual([['Request', 'GET /x']])
  const b = errorDetailOf({}, flattenEvent(glitch))
  expect(b.frames[0]).toMatchObject({ file: 'app.ts', line: 7, inApp: true, context: 'boom()' })
  expect(b.tags).toEqual([['env', 'prod']])
  expect(errorDetailOf(null, null).exception.type).toBe('Error')
})
