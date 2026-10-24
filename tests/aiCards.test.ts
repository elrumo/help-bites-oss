import { describe, expect, test } from 'bun:test'
import { AI_CARDS_MAX, readAiCards, readAiChatMessages } from '../shared/aiCards'

const options = { types: [{ key: 'bug', label: 'Bug' }], tags: [{ key: 'ios', label: 'iOS' }] }

describe('readAiCards', () => {
  test('keeps known types, tags and priorities and drops the rest', () => {
    const answer = { reply: 'Filed 2.', cards: [{ title: ' Crash  on launch ', body: 'Steps', type: 'bug', tags: ['ios', 'nope', 'ios'], priority: 'urgent' }, { title: 'Dark mode', type: 'idea' }, { title: '  ' }, 'junk'] }
    expect(readAiCards(answer, 'feedback', options)).toEqual({ reply: 'Filed 2.', cards: [{ title: 'Crash on launch', body: 'Steps', type: 'bug', tags: ['ios'] }, { title: 'Dark mode', body: '', tags: [] }] })
    expect(readAiCards(answer, 'board', options).cards[0]).toEqual({ title: 'Crash on launch', body: 'Steps', tags: ['ios'], priority: 'urgent' })
  })

  test('survives nonsense and caps the count', () => {
    expect(readAiCards(null, 'feedback', options)).toEqual({ reply: '', cards: [] })
    const many = { cards: Array.from({ length: AI_CARDS_MAX + 5 }, (_, i) => ({ title: `Card ${i}` })) }
    expect(readAiCards(many, 'feedback', options).cards).toHaveLength(AI_CARDS_MAX)
  })
})

describe('readAiChatMessages', () => {
  test('keeps the last turns and normalises roles', () => {
    const messages = readAiChatMessages([{ role: 'system', content: 'x' }, { role: 'assistant', content: 'ok' }, { content: '' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `m${i}` }))])
    expect(messages).toHaveLength(12)
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'm19' })
    expect(readAiChatMessages('nope')).toEqual([])
  })
})
