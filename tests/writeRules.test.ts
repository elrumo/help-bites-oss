import { describe, expect, test } from 'bun:test'
import { nextStateAfterMessage, stateAfterDelete, type ConversationState } from '../server/utils/conversations'

const empty: ConversationState = { status: 'done', unreadByAgent: 0, unreadByUser: 2, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessagePreview: 'old', lastMessageFrom: 'agent', context: null }

describe('conversation write rules', () => {
  test('a user message reopens and bumps the agent counter', () => {
    const next = nextStateAfterMessage(empty, { sender: 'user', body: 'hello\nthere', createdAt: '2026-01-02T00:00:00.000Z', context: null, attachments: [] })
    expect(next.status).toBe('open')
    expect(next.unreadByAgent).toBe(1)
    expect(next.unreadByUser).toBe(2)
    expect(next.lastMessagePreview).toBe('hello there')
    expect(next.lastMessageFrom).toBe('user')
  })

  test('an agent reply does not reopen and bumps the user counter', () => {
    const next = nextStateAfterMessage(empty, { sender: 'agent', body: 'hi', createdAt: '2026-01-02T00:00:00.000Z', context: null, attachments: [] })
    expect(next.status).toBe('done')
    expect(next.unreadByUser).toBe(3)
    expect(next.unreadByAgent).toBe(0)
  })

  test('context on a message becomes the conversation context; attachments-only gets a preview', () => {
    const ctx = { type: 'bookmark', id: 'b1', label: 'Some site' }
    const next = nextStateAfterMessage(empty, { sender: 'user', body: '', createdAt: 'x', context: ctx, attachments: [{ url: 'u', mime: 'image/png', size: 1 }] })
    expect(next.context).toEqual(ctx)
    expect(next.lastMessagePreview).toContain('Attachment')
    const keep = nextStateAfterMessage({ ...empty, context: ctx }, { sender: 'agent', body: 'ok', createdAt: 'x', context: null, attachments: [] })
    expect(keep.context).toEqual(ctx)
  })

  test('delete recomputes from the remaining last message and counters', () => {
    const next = stateAfterDelete(empty, { sender: 'user', body: 'left over', createdAt: '2025-12-31T00:00:00.000Z', attachments: [] }, { userReadAt: null, agentReadAt: null }, side => side === 'agent' ? 1 : 0)
    expect(next.lastMessagePreview).toBe('left over')
    expect(next.lastMessageFrom).toBe('user')
    expect(next.unreadByAgent).toBe(1)
    expect(next.unreadByUser).toBe(0)
    const none = stateAfterDelete(empty, null, { userReadAt: null, agentReadAt: null }, () => 0)
    expect(none.lastMessageAt).toBeNull()
    expect(none.lastMessageFrom).toBe('')
  })
})
