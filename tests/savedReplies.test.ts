import { describe, expect, test } from 'bun:test'
import {
  SAVED_REPLY_BODY_MAX_LENGTH,
  SAVED_REPLY_SHORTCUT_MAX_LENGTH,
  SAVED_REPLY_TITLE_MAX_LENGTH,
  fillSavedReply,
  matchSavedReplies,
  normalizeShortcut,
  readSavedReplyInput,
  replyFirstName
} from '../shared/savedReplies'

describe('fillSavedReply', () => {
  test('fills the first name and the full name from the customer', () => {
    expect(fillSavedReply('Hi {{firstName}}, this is {{name}}.', { name: 'Ada Lovelace' })).toBe('Hi Ada, this is Ada Lovelace.')
  })

  test('says "there" when the customer gave no name, so a greeting still reads', () => {
    expect(fillSavedReply('Hi {{firstName}},', { name: '' })).toBe('Hi there,')
    expect(fillSavedReply('Hi {{name}},', { name: '   ', email: 'ada@example.com' })).toBe('Hi there,')
    expect(fillSavedReply('Hi {{firstName}}', { name: null })).toBe('Hi there')
  })

  test('ignores spaces inside the braces and the letter case, and fills every occurrence', () => {
    expect(fillSavedReply('{{ firstName }} / {{FIRSTNAME}} / {{ Name }}', { name: 'Grace Hopper' })).toBe('Grace / Grace / Grace Hopper')
  })

  test('leaves other placeholders and single braces as written', () => {
    expect(fillSavedReply('Use {{code}} and {name} and {{firstName}}', { name: 'Ada' })).toBe('Use {{code}} and {name} and Ada')
  })

  test('takes the first word of a name with extra spaces', () => {
    expect(replyFirstName({ name: '  Mary  Jane Watson ' })).toBe('Mary')
    expect(fillSavedReply('{{name}}', { name: '  Mary  Jane Watson ' })).toBe('Mary  Jane Watson')
  })
})

describe('saved reply input', () => {
  test('a reply needs a title and a text; the shortcut is optional', () => {
    expect(readSavedReplyInput({}, { create: true }).errors).toEqual(['A title is required', 'The reply text is required'])
    const { values, errors } = readSavedReplyInput({ title: '  Refund  ', body: ' Hi {{firstName}} ', shortcut: '/Refund Policy' }, { create: true })
    expect(errors).toEqual([])
    expect(values).toEqual({ title: 'Refund', body: 'Hi {{firstName}}', shortcut: 'refund-policy' })
  })

  test('an edit checks only the keys it sends, and a null or empty shortcut clears it', () => {
    expect(readSavedReplyInput({ body: 'New text' }, { create: false })).toEqual({ values: { body: 'New text' }, errors: [] })
    expect(readSavedReplyInput({ shortcut: null }, { create: false }).values.shortcut).toBe('')
    expect(readSavedReplyInput({ title: '' }, { create: false }).errors).toEqual(['A title is required'])
  })

  test('limits: 120-character title, 8,000-character text, 30-character shortcut', () => {
    expect(readSavedReplyInput({ title: 'x'.repeat(SAVED_REPLY_TITLE_MAX_LENGTH + 1), body: 'ok' }, { create: true }).errors).toHaveLength(1)
    expect(readSavedReplyInput({ title: 'ok', body: 'x'.repeat(SAVED_REPLY_BODY_MAX_LENGTH + 1) }, { create: true }).errors).toHaveLength(1)
    expect(readSavedReplyInput({ title: 'x'.repeat(SAVED_REPLY_TITLE_MAX_LENGTH), body: 'x'.repeat(SAVED_REPLY_BODY_MAX_LENGTH) }, { create: true }).errors).toEqual([])
    expect(normalizeShortcut('a'.repeat(100))).toHaveLength(SAVED_REPLY_SHORTCUT_MAX_LENGTH)
    expect(readSavedReplyInput({ shortcut: 5 }, { create: false }).errors).toEqual(['shortcut must be text'])
  })

  test('shortcuts are lowercase handles', () => {
    expect(normalizeShortcut('///Hello World!')).toBe('hello-world')
    expect(normalizeShortcut(undefined)).toBe('')
    expect(normalizeShortcut('--a_b--')).toBe('a_b')
  })
})

describe('matchSavedReplies', () => {
  const library = [
    { title: 'Refund policy', body: 'You can ask for a refund within 30 days.', shortcut: 'refund' },
    { title: 'Pricing', body: 'Our refund-free plan is Starter.', shortcut: '' },
    { title: 'Welcome', body: 'Hello there', shortcut: 'hi' },
    { title: 'Éxito', body: 'Gracias', shortcut: '' }
  ]

  test('an empty query lists by title', () => {
    expect(matchSavedReplies(library, '').map(r => r.title)).toEqual(['Éxito', 'Pricing', 'Refund policy', 'Welcome'])
  })

  test('the shortcut first, then title matches, then the text', () => {
    expect(matchSavedReplies(library, 'refund').map(r => r.title)).toEqual(['Refund policy', 'Pricing'])
    expect(matchSavedReplies(library, '/refund')[0]!.title).toBe('Refund policy')
    expect(matchSavedReplies(library, 'wel').map(r => r.title)).toEqual(['Welcome'])
  })

  test('accents do not matter, nothing matching gives nothing, and the limit holds', () => {
    expect(matchSavedReplies(library, 'exito').map(r => r.title)).toEqual(['Éxito'])
    expect(matchSavedReplies(library, 'zzz')).toEqual([])
    expect(matchSavedReplies(library, 'e', 1)).toHaveLength(1)
  })
})
