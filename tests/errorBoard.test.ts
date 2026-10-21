import { describe, expect, test } from 'bun:test'
import { BOARD_ERROR_REFS_MAX, errorRefKey, readErrorRefs } from '../shared/board'
import { errorBoardDraft, errorDetailOf, trackerIssueUrl } from '../shared/errors'
import { errorConversationKey } from '../server/utils/errorTracking'

describe('trackerIssueUrl', () => {
  test('GlitchTip: the issues list address plus the issue id', () => {
    expect(trackerIssueUrl('glitchtip', 'https://gt.example.com/acme/issues', '42')).toBe('https://gt.example.com/acme/issues/42')
    expect(trackerIssueUrl('glitchtip', 'https://gt.example.com/acme/issues/', '42')).toBe('https://gt.example.com/acme/issues/42')
  })

  test('Bugsink: the issue page under the server, not the project list', () => {
    expect(trackerIssueUrl('bugsink', 'https://bs.example.com/issues/7/', 'abc-1')).toBe('https://bs.example.com/issues/issue/abc-1/event/last/')
  })

  test('nothing to link to', () => {
    expect(trackerIssueUrl('glitchtip', '', '42')).toBe('')
    expect(trackerIssueUrl('glitchtip', 'https://gt.example.com/acme/issues', '')).toBe('')
  })
})

describe('errorBoardDraft', () => {
  const event = { exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] } }

  test('a GlitchTip issue: its title, culprit, count and the tracker link', () => {
    const issue = { id: '42', title: 'TypeError: x is undefined', culprit: 'app/cart.js in total', count: '17', friendly_id: 'APP-9', last_seen: '2026-10-20T10:00:00Z' }
    const draft = errorBoardDraft(issue, errorDetailOf(issue, event), { providerName: 'GlitchTip', url: 'https://gt.example.com/acme/issues/42' })
    expect(draft.title).toBe('TypeError: x is undefined')
    expect(draft.culprit).toBe('app/cart.js in total')
    expect(draft.count).toBe(17)
    expect(draft.description).toContain('Filed from GlitchTip issue APP-9.')
    expect(draft.description).toContain('Seen: 17 times, last at 2026-10-20T10:00:00Z')
    expect(draft.description).toContain('[Open the issue in GlitchTip](https://gt.example.com/acme/issues/42)')
  })

  test('a Bugsink issue has no title: type and value, with its transaction as the culprit', () => {
    const issue = { id: 'abc', calculated_type: 'ValueError', calculated_value: 'bad input', transaction: '/api/pay', digested_event_count: 1 }
    const draft = errorBoardDraft(issue, errorDetailOf(issue, null), { providerName: 'Bugsink', url: '' })
    expect(draft.title).toBe('ValueError: bad input')
    expect(draft.culprit).toBe('/api/pay')
    expect(draft.description).toContain('Seen: 1 time')
    expect(draft.description).not.toContain('Open the issue')
  })

  test('with nothing but the latest event, the exception names it; with nothing at all, "Error"', () => {
    const issue = { id: '1' }
    expect(errorBoardDraft(issue, errorDetailOf(issue, event), { providerName: 'GlitchTip', url: '' }).title).toBe('TypeError: x is undefined')
    expect(errorBoardDraft(null, errorDetailOf(null, null), { providerName: 'GlitchTip', url: '' }).title).toBe('Error')
  })

  test('a long multi-line title is one line of at most 200 characters; backticks cannot break out of the culprit', () => {
    const issue = { id: '1', title: `Boom\n${'x'.repeat(400)}`, culprit: 'a`b' }
    const draft = errorBoardDraft(issue, errorDetailOf(issue, null), { providerName: 'GlitchTip', url: '' })
    expect(draft.title.length).toBeLessThanOrEqual(200)
    expect(draft.title).not.toContain('\n')
    expect(draft.description).toContain("`a'b`")
  })
})

describe('error refs on a board item', () => {
  test('the key is the one the error\'s conversation uses', () => {
    expect(errorRefKey('glitchtip', '42')).toBe(errorConversationKey('glitchtip', '42'))
  })

  test('stored refs are read leniently and capped', () => {
    expect(readErrorRefs(undefined)).toEqual([])
    expect(readErrorRefs('nope')).toEqual([])
    expect(readErrorRefs([{ provider: 'glitchtip', issueId: '42', linkId: 'main', title: 'Boom', url: 'https://x.test/42', extra: 1 }, { provider: 'glitchtip' }, null, 7]))
      .toEqual([{ provider: 'glitchtip', issueId: '42', linkId: 'main', title: 'Boom', url: 'https://x.test/42' }])
    const many = Array.from({ length: BOARD_ERROR_REFS_MAX + 5 }, (_, i) => ({ provider: 'bugsink', issueId: String(i) }))
    expect(readErrorRefs(many)).toHaveLength(BOARD_ERROR_REFS_MAX)
  })
})
