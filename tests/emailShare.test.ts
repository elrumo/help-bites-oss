import { describe, expect, test } from 'bun:test'
import type { EmailEvent } from '../server/utils/events'
import { SHARE_DEFAULT_DAYS, shareEditRefusal, shareExpiresAt, shareLinkActive, sharedEmailTemplate, type EmailTemplate } from '../server/utils/emails'
import { CHANGELOG_DIGEST_TEMPLATE } from '../server/utils/changelogNotify'
import { CHANGELOG_CONFIRM_TEMPLATE } from '../server/utils/changelogSubscriptions'

// sse.ts leans on nitro's auto-imports; stub them before loading it.
const g = globalThis as Record<string, unknown>
let listener: ((e: EmailEvent) => void) | null = null
g.setResponseHeaders = () => {}
g.subscribeEmailEvents = (_templateId: string, fn: (e: EmailEvent) => void) => {
  listener = fn
  return () => { listener = null }
}
const { streamEmailEvents } = await import('../server/utils/sse')

const status = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
  return 0
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 7, 12)

const template: EmailTemplate = {
  id: 't1',
  projectId: 'p1',
  masterId: null,
  folderId: 'f1',
  key: 'welcome',
  name: 'Welcome',
  description: 'internal note',
  document: { settings: {}, blocks: [] } as unknown as EmailTemplate['document'],
  variables: [{ key: 'firstName' }],
  variableValues: { plan: 'pro' },
  shareMode: 'edit',
  shareToken: 'secret-token',
  shareExpiresAt: NOW + DAY,
  lastSharedEdit: { at: '2026-10-07T12:00:00.000Z', ip: '203.0.113.9' },
  lastActorId: 'tab-1',
  updatedAt: NOW,
  master: null
}

describe('share links', () => {
  test('edit links are refused for masters, linked rows and the server\'s own mail', () => {
    expect(shareEditRefusal(template)).toBeNull()
    expect(shareEditRefusal({ ...template, projectId: null })).toContain('master')
    expect(shareEditRefusal({ ...template, masterId: 'm1' })).toContain('linked master')
    for (const key of ['confirm-subscription', CHANGELOG_CONFIRM_TEMPLATE, CHANGELOG_DIGEST_TEMPLATE]) {
      expect(shareEditRefusal({ ...template, key })).toContain('mail the server sends itself')
    }
    expect(shareEditRefusal({ ...template, key: 'changelog-weekly-promo' })).toBeNull()
  })

  test('expiry defaults by mode, and a picked lifetime must be 1 to 90 whole days', () => {
    expect(shareExpiresAt('edit', undefined, NOW).getTime()).toBe(NOW + SHARE_DEFAULT_DAYS.edit * DAY)
    expect(shareExpiresAt('view', null, NOW).getTime()).toBe(NOW + SHARE_DEFAULT_DAYS.view * DAY)
    expect(SHARE_DEFAULT_DAYS).toEqual({ view: 30, edit: 7 })
    expect(shareExpiresAt('edit', 1, NOW).getTime()).toBe(NOW + DAY)
    expect(shareExpiresAt('view', 90, NOW).getTime()).toBe(NOW + 90 * DAY)
    for (const bad of [0, 91, -1, 1.5, '7', true, Number.NaN]) expect(status(() => shareExpiresAt('edit', bad, NOW))).toBe(400)
  })

  test('a link opens only while shared and before its expiry; one with no date never does', () => {
    expect(shareLinkActive('edit', new Date(NOW + 1), NOW)).toBe(true)
    expect(shareLinkActive('view', new Date(NOW + 1), NOW)).toBe(true)
    expect(shareLinkActive('view', new Date(NOW), NOW)).toBe(false)
    expect(shareLinkActive('edit', new Date(NOW - DAY), NOW)).toBe(false)
    // Shared before links expired: no date.
    expect(shareLinkActive('edit', undefined, NOW)).toBe(false)
    expect(shareLinkActive(undefined, new Date(NOW + DAY), NOW)).toBe(false)
  })

  test('a link holder sees the design only', () => {
    const shared = sharedEmailTemplate(template)
    expect(shared).toEqual({ name: 'Welcome', document: template.document, variables: template.variables, lastActorId: 'tab-1', updatedAt: NOW })
    expect(JSON.stringify(shared)).not.toMatch(/p1|f1|t1|secret-token|203\.0\.113\.9|internal note|pro/)
  })

  test('the email stream sends what `map` returns and drops what it rejects', async () => {
    const decoder = new TextDecoder()
    const reader = streamEmailEvents({} as never, 't1', e => (e.template.name === 'drop' ? null : { ...e, template: sharedEmailTemplate(e.template) })).getReader()
    expect(decoder.decode((await reader.read()).value)).toBe('event: ready\ndata: {}\n\n')

    listener!({ type: 'email.updated', templateId: 'other', template })
    listener!({ type: 'email.updated', templateId: 't1', template: { ...template, name: 'drop' } })
    listener!({ type: 'email.updated', templateId: 't1', template })
    const frame = decoder.decode((await reader.read()).value)
    expect(frame.startsWith('event: email.updated\n')).toBe(true)
    expect(JSON.parse(frame.split('data: ')[1]!)).toEqual({ type: 'email.updated', templateId: 't1', template: sharedEmailTemplate(template) })
    await reader.cancel()
    expect(listener).toBeNull()
  })
})
