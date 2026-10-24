import { describe, expect, test } from 'bun:test'
import { ITEM_ATTACHMENTS_MAX, readItemAttachments } from '../shared/itemAttachments'
import { readFeedbackPostInput, DEFAULT_FEEDBACK_CONFIG } from '../shared/feedback'
import { DEFAULT_BOARD_CONFIG, readBoardItemInput } from '../shared/board'

const file = { url: 'https://cdn.example/p1/u/a.pdf', name: 'spec.pdf', mime: 'application/pdf', size: 12 }

describe('readItemAttachments', () => {
  test('keeps the four fields, fills a missing name and clears on null', () => {
    const errors: string[] = []
    expect(readItemAttachments([{ ...file, extra: 1 }, { url: 'https://cdn.example/p1/u/b.png' }], errors)).toEqual([file, { url: 'https://cdn.example/p1/u/b.png', name: 'b.png', mime: '', size: 0 }])
    expect(readItemAttachments(null, errors)).toEqual([])
    expect(errors).toEqual([])
  })

  test('reports a non-list, a bad url and too many', () => {
    const errors: string[] = []
    expect(readItemAttachments('x', errors)).toBeUndefined()
    expect(readItemAttachments([{ url: 'javascript:alert(1)' }], errors)).toBeUndefined()
    expect(readItemAttachments(Array.from({ length: ITEM_ATTACHMENTS_MAX + 1 }, () => file), errors)).toBeUndefined()
    expect(errors).toHaveLength(3)
  })
})

describe('posts and board items accept attachments', () => {
  test('a post author, not only an admin, can attach', () => {
    const { values, errors } = readFeedbackPostInput({ title: 'Crash', attachments: [file] }, DEFAULT_FEEDBACK_CONFIG, { admin: false, create: true })
    expect(errors).toEqual([])
    expect(values.attachments).toEqual([file])
  })

  test('a board item takes them too', () => {
    const { values, errors } = readBoardItemInput({ title: 'Fix', attachments: [file] }, DEFAULT_BOARD_CONFIG, { create: true })
    expect(errors).toEqual([])
    expect(values.attachments).toEqual([file])
  })
})
