import { describe, expect, test } from 'bun:test'
import { startConversationClaims } from '../server/utils/startConversation'

const row = (fields: Record<string, string>) => ({ get: (key: string) => fields[key] })

describe('starting a conversation with a customer', () => {
  test('a customer on record keeps their name and address', () => {
    expect(startConversationClaims(row({ name: 'Ada', email: 'ada@example.com' }), { name: 'Mallory', email: 'mallory@evil.example' }, 'u1'))
      .toEqual({ sub: 'u1', name: 'Ada', email: 'ada@example.com' })
  })

  test('what is missing is filled in', () => {
    expect(startConversationClaims(row({ name: 'Ada' }), { name: 'Other', email: 'ada@example.com' }, 'u1')).toEqual({ sub: 'u1', name: 'Ada', email: 'ada@example.com' })
    expect(startConversationClaims(null, { name: 'New', email: 'new@example.com' }, 'u2')).toEqual({ sub: 'u2', name: 'New', email: 'new@example.com' })
    expect(startConversationClaims(undefined, {}, 'u3')).toEqual({ sub: 'u3', name: '', email: '' })
  })
})
