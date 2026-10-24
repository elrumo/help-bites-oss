import { describe, expect, test } from 'bun:test'
import { boardDraftSystemPrompt, boardDraftUserMessage, readBoardItemDraft } from '../shared/boardFromFeedback'

const labels = [{ key: 'ios', label: 'iOS' }, { key: 'api', label: 'API' }]

describe('readBoardItemDraft', () => {
  test('keeps known priorities and labels and drops the rest', () => {
    const draft = readBoardItemDraft({ title: '  Filter by  protected ', description: ' Photographers lock files. ', priority: 'high', labels: ['ios', 'nope', 'ios'] }, labels)
    expect(draft).toEqual({ title: 'Filter by protected', description: 'Photographers lock files.', priority: 'high', labels: ['ios'] })
    expect(readBoardItemDraft({ title: 'x', priority: 'asap' }, labels)).toEqual({ title: 'x', description: '', priority: '', labels: [] })
  })

  test('is null without a title and survives nonsense', () => {
    expect(readBoardItemDraft({ title: '  ' }, labels)).toBeNull()
    expect(readBoardItemDraft(null, labels)).toBeNull()
    expect(readBoardItemDraft([], labels)).toBeNull()
  })
})

describe('prompts', () => {
  test('list the board labels and mark the post as data', () => {
    expect(boardDraftSystemPrompt(labels)).toContain('"ios" (iOS)')
    expect(boardDraftSystemPrompt([])).toContain('none defined')
    expect(boardDraftSystemPrompt([])).toContain('DATA')
    const message = boardDraftUserMessage({ title: 'T', body: 'B', type: 'bug', voteCount: 3, commentCount: 1, tags: [] })
    expect(message).toContain('Votes: 3, comments: 1')
    expect(message).toContain('Title: T')
  })
})
