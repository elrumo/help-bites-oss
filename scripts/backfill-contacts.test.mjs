import { expect, test } from 'bun:test'
import { contactFix } from './backfill-contacts.mjs'

test('lowercases addresses and fills the subscription default, nothing else', () => {
  expect(contactFix({ email: 'Ada@Example.COM' })).toEqual({ email: 'ada@example.com', subscription: 'none' })
  expect(contactFix({ email: 'ada@example.com', subscription: 'unsubscribed' })).toBeNull()
  expect(contactFix({ subscription: 'subscribed' })).toBeNull()
  expect(contactFix({})).toEqual({ subscription: 'none' })
})

test('guesses how older contacts were added, once', () => {
  expect(contactFix({ subscription: 'none', externalId: 'u_1', createdAt: '2025-01-01T00:00:00.000Z' })).toEqual({ origin: { type: 'app', id: '', at: '2025-01-01T00:00:00.000Z' } })
  expect(contactFix({ subscription: 'subscribed', consent: { source: 'import' } }).origin.type).toBe('import')
  expect(contactFix({ subscription: 'subscribed', consent: { source: 'form' } }).origin.type).toBe('signup')
  expect(contactFix({ subscription: 'none', sources: ['src1234567'] }).origin).toEqual({ type: 'sync', id: 'src1234567', at: null })
  expect(contactFix({ subscription: 'none', externalId: 'u_1', origin: { type: 'api' } })).toBeNull()
})
