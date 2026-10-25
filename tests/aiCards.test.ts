import { describe, expect, test } from 'bun:test'
import { AI_CARDS_MAX, aiCardsSystemPrompt, readAiCards, readAiChatMessages } from '../shared/aiCards'

const options = { types: [{ key: 'bug', label: 'Bug' }], tags: [{ key: 'ios', label: 'iOS' }] }
const board = {
  tags: [{ key: 'ios', label: 'iOS' }, { key: 'editor', label: 'Editor' }],
  statuses: [{ key: 'open', label: 'Open' }, { key: 'done', label: 'Done' }],
  items: [{ number: 12, title: 'Export CSV', status: 'open', priority: '', labels: ['ios'] }]
}

describe('readAiCards', () => {
  test('keeps known types, tags and priorities and drops the rest', () => {
    const answer = { reply: 'Filed 2.', cards: [{ title: ' Crash  on launch ', body: 'Steps', type: 'bug', tags: ['ios', 'nope', 'ios'], priority: 'urgent' }, { title: 'Dark mode', type: 'idea' }, { title: '  ' }, 'junk'] }
    expect(readAiCards(answer, 'feedback', options)).toEqual({ reply: 'Filed 2.', cards: [{ title: 'Crash on launch', body: 'Steps', type: 'bug', tags: ['ios'] }, { title: 'Dark mode', body: '', tags: [] }], updates: [], links: [] })
    expect(readAiCards(answer, 'board', board).cards[0]).toEqual({ title: 'Crash on launch', body: 'Steps', tags: ['ios'], priority: 'urgent' })
  })

  test('survives nonsense and caps the count', () => {
    expect(readAiCards(null, 'feedback', options)).toEqual({ reply: '', cards: [], updates: [], links: [] })
    const many = { cards: Array.from({ length: AI_CARDS_MAX + 5 }, (_, i) => ({ title: `Card ${i}` })) }
    expect(readAiCards(many, 'feedback', options).cards).toHaveLength(AI_CARDS_MAX)
  })
})

describe('readAiCards on the board', () => {
  test('keeps card refs that can be named, and drops the rest', () => {
    const answer = { cards: [{ ref: 'login', title: 'Login bug' }, { ref: '12', title: 'Numbered ref' }, { ref: '#3', title: 'Hash ref' }, { title: 'No ref' }] }
    expect(readAiCards(answer, 'board', board).cards).toEqual([{ ref: 'login', title: 'Login bug', body: '', tags: [] }, { title: 'Numbered ref', body: '', tags: [] }, { title: 'Hash ref', body: '', tags: [] }, { title: 'No ref', body: '', tags: [] }])
  })

  test('reads item updates with only the known fields, values checked', () => {
    const answer = {
      updates: [
        { item: '#12', set: { status: 'done', priority: 'urgent', labels: ['ios', 'nope', 'editor'], targetDate: '2026-11-15', public: true, rank: 3, assigneeId: 'x' } },
        { item: '#12', set: { status: 'nonsense', priority: null, targetDate: 'next week', title: '  Renamed  ' } },
        { item: '#13', set: { rank: 9 } },
        { item: '', set: { status: 'done' } },
        'junk'
      ]
    }
    expect(readAiCards(answer, 'board', board).updates).toEqual([
      { item: '#12', set: { status: 'done', priority: 'urgent', labels: ['ios', 'editor'], targetDate: '2026-11-15', public: true } },
      { item: '#12', set: { priority: '', title: 'Renamed' } }
    ])
    expect(readAiCards(answer, 'feedback', options).updates).toEqual([])
  })

  test('reads links, and drops self-links and junk', () => {
    const answer = { links: [{ from: '#12', to: '#14' }, { from: '#12', to: '#12' }, { from: '#15', to: '#16', linked: false }, { from: '#17' }] }
    expect(readAiCards(answer, 'board', board).links).toEqual([{ from: '#12', to: '#14', linked: true }, { from: '#15', to: '#16', linked: false }])
  })

  test('the prompt shows the items and the rules for changing them', () => {
    const prompt = aiCardsSystemPrompt('board', board)
    expect(prompt).toContain('#12 [open] ios Export CSV')
    expect(prompt).toContain('"updates"')
    expect(prompt).toContain('"links"')
    expect(prompt).toContain('"ref"')
    expect(aiCardsSystemPrompt('feedback', options)).not.toContain('"updates"')
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
