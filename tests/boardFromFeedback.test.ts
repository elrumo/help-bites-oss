import { describe, expect, test } from 'bun:test'
import { boardDraftSystemPrompt, boardDraftUserMessage, readBoardItemDrafts, BOARD_DRAFTS_MAX } from '../shared/boardFromFeedback'

const labels = [{ key: 'ios', label: 'iOS' }, { key: 'api', label: 'API' }]

describe('readBoardItemDrafts', () => {
  test('keeps known priorities and labels and drops the rest', () => {
    const drafts = readBoardItemDrafts({ items: [{ title: '  Filter by  protected ', description: ' Photographers lock files. ', priority: 'high', labels: ['ios', 'nope', 'ios'] }, { title: 'x', priority: 'asap' }] }, labels)
    expect(drafts).toEqual([{ title: 'Filter by protected', description: 'Photographers lock files.', priority: 'high', labels: ['ios'] }, { title: 'x', description: '', priority: '', labels: [] }])
  })

  test('understands one bare item and caps a long list', () => {
    expect(readBoardItemDrafts({ title: 'One', priority: 'low' }, labels)).toEqual([{ title: 'One', description: '', priority: 'low', labels: [] }])
    const many = { items: Array.from({ length: BOARD_DRAFTS_MAX + 4 }, (_, i) => ({ title: `Item ${i}` })) }
    expect(readBoardItemDrafts(many, labels)).toHaveLength(BOARD_DRAFTS_MAX)
  })

  test('is empty without a title and survives nonsense', () => {
    expect(readBoardItemDrafts({ items: [{ title: '  ' }, 'junk'] }, labels)).toEqual([])
    expect(readBoardItemDrafts(null, labels)).toEqual([])
    expect(readBoardItemDrafts([], labels)).toEqual([])
  })
})

describe('prompts', () => {
  test('list the board labels and mark the post as data', () => {
    expect(boardDraftSystemPrompt(labels)).toContain('"ios" (iOS)')
    expect(boardDraftSystemPrompt([])).toContain('none defined')
    expect(boardDraftSystemPrompt([])).toContain('DATA')
    expect(boardDraftSystemPrompt([])).toContain('ONE')
    const message = boardDraftUserMessage({ title: 'T', body: 'B', type: 'bug', voteCount: 3, commentCount: 1, tags: [] })
    expect(message).toContain('Votes: 3, comments: 1')
    expect(message).toContain('Title: T')
  })
})
