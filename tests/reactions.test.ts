import { describe, expect, test } from 'bun:test'
import { isReactionEmoji, normalizeReactions, toggleReactions, type MessageReaction } from '../shared/support'

describe('message reactions', () => {
  test('only the six tapbacks are accepted', () => {
    expect(isReactionEmoji('❤️')).toBe(true)
    expect(isReactionEmoji('🎉')).toBe(false)
    expect(isReactionEmoji('')).toBe(false)
    expect(isReactionEmoji(undefined)).toBe(false)
  })

  test('toggle adds, toggling again takes it back', () => {
    const actor = { actor: 'user', side: 'user' as const, actorName: 'Sam' }
    const added = toggleReactions([], '❤️', actor, '2026-01-01T00:00:00.000Z')
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ emoji: '❤️', actor: 'user', side: 'user', actorName: 'Sam' })
    const removed = toggleReactions(added, '❤️', actor, '2026-01-02T00:00:00.000Z')
    expect(removed).toHaveLength(0)
  })

  test('picking the same emoji again takes it back — never duplicates', () => {
    const user = { actor: 'user', side: 'user' as const, actorName: 'Sam' }
    const agent = { actor: 'agent:a1', side: 'agent' as const, actorName: 'Ada' }
    let list = toggleReactions([], '👍', user, 't1')
    list = toggleReactions(list, '👍', user, 't2')
    expect(list).toHaveLength(0)
    list = toggleReactions(list, '👍', user, 't3')
    list = toggleReactions(list, '👍', agent, 't4')
    expect(list).toHaveLength(2)
    list = toggleReactions(list, '👍', user, 't5')
    expect(list).toHaveLength(1)
    expect(list[0]!.actor).toBe('agent:a1')
  })

  test('the same reactor can stack different emojis', () => {
    const actor = { actor: 'user', side: 'user' as const, actorName: 'Sam' }
    let list = toggleReactions([], '❤️', actor, 't1')
    list = toggleReactions(list, '😆', actor, 't2')
    expect(list.map(r => r.emoji).sort()).toEqual(['❤️', '😆'])
  })

  test('normalize keeps good tapbacks and drops junk', () => {
    const reactions = normalizeReactions([
      { emoji: '👍', actor: 'user', side: 'user', actorName: 'Sam', at: 't' },
      { emoji: '🎉', actor: 'user', side: 'user', actorName: 'Sam', at: 't' },
      { emoji: '👍', actor: '', side: 'user', actorName: 'Ghost', at: 't' },
      'nope',
      null
    ])
    expect(reactions).toHaveLength(1)
    expect(reactions[0]!.actor).toBe('user')
    expect(normalizeReactions(undefined)).toEqual([])
  })
})
