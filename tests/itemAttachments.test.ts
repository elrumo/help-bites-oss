import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ITEM_ATTACHMENTS_MAX, ITEM_BLOCKED_EXTENSIONS, ITEM_FILE_MAX_BYTES, ITEM_VIDEO_MAX_BYTES, isMediaMime, itemFileMaxBytes, itemFileMime, looksExecutable, readItemAttachments } from '../shared/itemAttachments'
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

describe('videos', () => {
  test('MP4 and MOV get the larger limit, by type or by name; other files keep 25 MB', () => {
    expect(itemFileMaxBytes('video/mp4')).toBe(ITEM_VIDEO_MAX_BYTES)
    expect(itemFileMaxBytes('Screen Recording.MOV')).toBe(ITEM_VIDEO_MAX_BYTES)
    expect(itemFileMaxBytes('spec.pdf')).toBe(ITEM_FILE_MAX_BYTES)
    expect(itemFileMaxBytes('application/pdf')).toBe(ITEM_FILE_MAX_BYTES)
  })

  test('images and videos open in the viewer, files do not', () => {
    expect([isMediaMime('image/png'), isMediaMime('video/quicktime'), isMediaMime('application/pdf')]).toEqual([true, true, false])
  })
})

describe('any file, but never a program', () => {
  test('known extensions keep their type, anything else is opaque bytes', () => {
    expect([itemFileMime('a.pdf'), itemFileMime('mock.fig'), itemFileMime('noext'), itemFileMime('x.constructor'), itemFileMime('x.html')]).toEqual(['application/pdf', 'application/octet-stream', 'application/octet-stream', 'application/octet-stream', 'application/octet-stream'])
  })

  test('executable bytes are recognised under any name', () => {
    expect([looksExecutable(Uint8Array.of(0x4D, 0x5A, 0, 0)), looksExecutable(Uint8Array.of(0x7F, 0x45, 0x4C, 0x46)), looksExecutable(Uint8Array.of(0x23, 0x21, 0x2F, 0x62)), looksExecutable(Uint8Array.of(0x25, 0x50, 0x44, 0x46))]).toEqual([true, true, true, false])
  })

  test('the native app blocks the same extensions', () => {
    const swift = readFileSync(new URL('../helpbites-native/App/Features/Feedback/AttachmentsSection.swift', import.meta.url), 'utf8')
    const listed = swift.match(/blockedExtensions: Set<String> = \[([^\]]*)\]/)![1]!.match(/"(\w+)"/g)!.map(x => x.replace(/"/g, ''))
    expect(listed).toEqual([...ITEM_BLOCKED_EXTENSIONS])
  })
})
