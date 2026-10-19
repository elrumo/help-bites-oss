import { expect, test } from 'bun:test'
import { applyTrackerSettings, bugsinkActionsFor, bugsinkIssueRow, buildErrorPrompt, issueQuery, levelToPriority, parseAlertWebhook, parseBugsinkWebhook, pickTrackerSettings } from '#shared/errors'

test('error helpers parse, quote and trim safely', () => {
  expect(parseAlertWebhook({ attachments: [{ title: 'Boom', title_link: 'https://gt.example/acme/issues/42/' }, {}] })).toEqual([{ issueId: '42', title: 'Boom', url: 'https://gt.example/acme/issues/42/', culprit: '' }])
  expect(issueQuery({ status: 'unresolved', userId: 'a"b', search: 'payment' })).toBe('is:unresolved user.id:"a\\"b" payment')
  expect(levelToPriority('fatal')).toBe('urgent')
  expect(buildErrorPrompt({ exception: { values: [{ type: 'Error', value: 'bad' }] }, breadcrumbs: { values: Array.from({ length: 20 }, (_, i) => ({ message: String(i) })) } }).length).toBeLessThan(12_001)
})

test('bugsink helpers shape issues, alerts and status changes', () => {
  const issue = { id: 'u-1', friendly_id: 'HB-3', calculated_type: 'TypeError', calculated_value: 'x is undefined', transaction: '/checkout', digested_event_count: 4, is_resolved: false, is_muted: false }
  expect(bugsinkIssueRow(issue, 'https://bs.example')).toMatchObject({ id: 'u-1', title: 'TypeError: x is undefined', culprit: '/checkout', count: 4, status: 'unresolved', url: 'https://bs.example/issues/issue/u-1/event/last/' })
  expect(parseBugsinkWebhook({ ...issue, title: 'TypeError: x', url: 'https://bs.example/i', alert_reason: 'NEW' })).toEqual([{ issueId: 'u-1', title: 'TypeError: x', url: 'https://bs.example/i', culprit: '/checkout' }])
  expect(parseBugsinkWebhook({ ...issue, alert_reason: 'TEST' })).toEqual([])
  expect(bugsinkActionsFor(issue, 'resolved')).toEqual(['resolve'])
  expect(bugsinkActionsFor({ ...issue, is_resolved: true }, 'closed')).toEqual(['reopen', 'mute'])
  expect(bugsinkActionsFor({ ...issue, is_muted: true }, 'open')).toEqual(['unmute'])
  expect(bugsinkActionsFor(issue, 'open')).toEqual([])
})

test('tracker settings resolve whole layers and never carry a token to a new host', () => {
  const required = ['url', 'token', 'org'] as const
  const full = { url: 'https://gt.example', token: 't', org: 'acme' }
  expect(pickTrackerSettings([...required], [['project', { url: 'https://other.example' }], ['global', full], ['env', {}]])).toEqual({ source: 'global', settings: full })
  expect(pickTrackerSettings([...required], [['project', undefined], ['global', undefined], ['env', { url: 'x' }]])).toBeNull()

  expect(applyTrackerSettings(full, { url: 'https://gt.example/', org: 'acme' }, [...required]).settings?.token).toBe('t')
  expect(applyTrackerSettings(full, { url: 'https://evil.example', org: 'acme' }, [...required]).error).toBe('Missing token')
  expect(applyTrackerSettings(full, { url: 'ftp://gt.example', token: 'n', org: 'acme' }, [...required]).error).toMatch(/http/)
  expect(applyTrackerSettings(full, { url: '' }, [...required])).toEqual({ settings: null, error: '' })
})
