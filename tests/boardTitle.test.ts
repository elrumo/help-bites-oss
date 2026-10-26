import { describe, expect, test } from 'bun:test'
import { BOARD_TITLE_INPUT_MAX, BOARD_TITLE_MAX, boardTitlePrompt, fallbackBoardTitle, readBoardTitle } from '../shared/boardTitle'

describe('readBoardTitle', () => {
  test('reads a fenced reply on one line, without quotes, trimmed to the limit', () => {
    expect(readBoardTitle('```json\n{"title":"  \\"CSV export\\n for contacts\\" "}\n```')).toBe('CSV export for contacts')
    expect(readBoardTitle(JSON.stringify({ title: 'x'.repeat(500) }))!.length).toBe(BOARD_TITLE_MAX)
  })
  test('nothing usable is null', () => {
    expect(readBoardTitle('{"title":3}')).toBeNull()
    expect(readBoardTitle('{"title":"  "}')).toBeNull()
    expect(readBoardTitle('sorry')).toBeNull()
  })
})

describe('boardTitlePrompt', () => {
  test('sends the trimmed description, cut to the input limit', () => {
    expect(boardTitlePrompt('  Export contacts  ')).toBe('Description:\nExport contacts')
    expect(boardTitlePrompt('y'.repeat(BOARD_TITLE_INPUT_MAX + 50)).length).toBe('Description:\n'.length + BOARD_TITLE_INPUT_MAX)
  })
})

describe('fallbackBoardTitle', () => {
  test('takes the first line without markdown marks', () => {
    expect(fallbackBoardTitle('\n## Export contacts\nMore detail')).toBe('Export contacts')
    expect(fallbackBoardTitle('- [ ] Fix login')).toBe('[ ] Fix login')
  })
  test('cuts a long line at a word', () => {
    const title = fallbackBoardTitle('word '.repeat(40))
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(81)
  })
  test('is empty for an empty description', () => {
    expect(fallbackBoardTitle('  \n ')).toBe('')
  })
})
