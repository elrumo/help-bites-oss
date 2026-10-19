import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { mailgunEventUpdate, readEmailLogQuery, readSuppressionInput, statusAfter, verifyMailgunSignature } from '../server/utils/emailLogs'
import { importItemDocument } from '../server/utils/emailImport'

const status = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
  return 0
}

describe('Mailgun webhooks', () => {
  const key = 'whsec-test'
  const sign = (timestamp: string, token: string) => createHmac('sha256', key).update(timestamp + token).digest('hex')

  test('only a correctly signed payload passes', () => {
    const sig = { timestamp: '1759500000', token: 'tok123', signature: sign('1759500000', 'tok123') }
    expect(verifyMailgunSignature(sig, key)).toBe(true)
    expect(verifyMailgunSignature({ ...sig, token: 'other' }, key)).toBe(false)
    expect(verifyMailgunSignature(sig, 'wrong-key')).toBe(false)
    expect(verifyMailgunSignature(undefined, key)).toBe(false)
    expect(verifyMailgunSignature(sig, '')).toBe(false)
  })

  test('events map to a status, and hard failures, complaints and unsubscribes suppress', () => {
    expect(mailgunEventUpdate({ event: 'delivered', timestamp: 1759500000, 'delivery-status': { message: 'OK' } })).toEqual({ status: 'delivered', event: { type: 'delivered', at: '2025-10-03T14:00:00.000Z', detail: 'OK' } })
    expect(mailgunEventUpdate({ event: 'failed', severity: 'permanent', timestamp: 1, 'delivery-status': { description: 'No such user' } })).toMatchObject({ status: 'bounced', suppress: { reason: 'bounce', detail: 'No such user' } })
    expect(mailgunEventUpdate({ event: 'failed', severity: 'temporary', timestamp: 1 })).toMatchObject({ status: null, event: { type: 'deferred' } })
    expect(mailgunEventUpdate({ event: 'complained', timestamp: 1 })).toMatchObject({ status: 'complained', suppress: { reason: 'complaint' } })
    expect(mailgunEventUpdate({ event: 'unsubscribed', timestamp: 1 })).toMatchObject({ status: 'unsubscribed', suppress: { reason: 'unsubscribe' } })
    expect(mailgunEventUpdate({ event: 'clicked', timestamp: 1, url: 'https://x.test' })).toMatchObject({ status: 'clicked', event: { detail: 'https://x.test' } })
    expect(mailgunEventUpdate({ event: 'accepted', timestamp: 1 })).toBeNull()
  })

  test('a late event never moves an entry backwards', () => {
    expect(statusAfter('sent', 'delivered')).toBe('delivered')
    expect(statusAfter('opened', 'delivered')).toBe('opened')
    expect(statusAfter('delivered', 'bounced')).toBe('bounced')
    expect(statusAfter('complained', 'opened')).toBe('complained')
    expect(statusAfter('sent', null)).toBe('sent')
  })
})

describe('reading requests', () => {
  test('log filters', () => {
    const filters = readEmailLogQuery({ status: 'bounced', template: 'welcome', to: 'Ada@Example.com', since: '2026-10-01', limit: '500' })
    expect(filters).toMatchObject({ status: 'bounced', template: 'welcome', to: 'ada@example.com', limit: 200 })
    expect(filters.since?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(status(() => readEmailLogQuery({ status: 'lost' }))).toBe(400)
    expect(status(() => readEmailLogQuery({ before: 'yesterday' }))).toBe(400)
  })

  test('suppression input: a list or a pasted string, checked and deduplicated', () => {
    expect(readSuppressionInput({ emails: 'a@example.com, B@example.com\na@example.com', reason: 'unsubscribe' })).toEqual({ emails: ['a@example.com', 'b@example.com'], reason: 'unsubscribe', detail: '' })
    expect(status(() => readSuppressionInput({ emails: [] }))).toBe(400)
    expect(status(() => readSuppressionInput({ emails: ['nope'] }))).toBe(400)
    expect(status(() => readSuppressionInput({ emails: ['a@example.com'], reason: 'spite' }))).toBe(400)
  })

  test('import items: html becomes one block with subject, preheader and text; a document takes overrides', () => {
    const doc = importItemDocument({ key: 'reset', subject: 'Reset your password', text: 'Reset: {{link}}', html: '<span style="display:none">Reset it</span><table><tr><td><a href="{{link}}">Reset</a></td></tr></table>' })!
    expect(doc.settings).toMatchObject({ title: 'Reset your password', preheader: 'Reset it', text: 'Reset: {{link}}' })
    expect(doc.blocks).toHaveLength(1)
    const again = importItemDocument({ key: 'reset', document: doc, subject: 'New subject' })!
    expect(again.settings.title).toBe('New subject')
    expect(importItemDocument({ key: 'linked', master: 'Welcome' })).toBeNull()
    expect(status(() => importItemDocument({ key: 'empty' }))).toBe(400)
  })
})
