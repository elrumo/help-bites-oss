import { expect, test } from 'bun:test'
import { contactFix } from './backfill-contacts.mjs'

test('lowercases addresses and fills the subscription default, nothing else', () => {
  expect(contactFix({ email: 'Ada@Example.COM' })).toEqual({ email: 'ada@example.com', subscription: 'none' })
  expect(contactFix({ email: 'ada@example.com', subscription: 'unsubscribed' })).toBeNull()
  expect(contactFix({ subscription: 'subscribed' })).toBeNull()
  expect(contactFix({})).toEqual({ subscription: 'none' })
})
