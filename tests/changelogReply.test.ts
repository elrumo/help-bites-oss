import { describe, expect, test } from 'bun:test'
import { CHANGELOG_REPLY_SEND_MAX, defaultReplyBody, mergeConversationIds, readChangelogReplyInput } from '../shared/changelogReply'

describe('defaultReplyBody', () => {
  test('the entry\'s title and its public address', () => {
    expect(defaultReplyBody('Dark mode', 'https://acme.test/changelog/dark-mode')).toBe('Good news: “Dark mode” has just shipped.\n\nSee what changed: https://acme.test/changelog/dark-mode')
  })
  test('no address, no link line; no title, still a sentence', () => {
    expect(defaultReplyBody('Dark mode', '')).toBe('Good news: “Dark mode” has just shipped.')
    expect(defaultReplyBody('  ', '')).toContain('“your request”')
  })
})

describe('mergeConversationIds', () => {
  test('the entry\'s own conversations, then its board items\', once each', () => {
    expect(mergeConversationIds(['c1', 'c2'], [{ conversationIds: ['c2', 'c3'] }, { conversationIds: ['c1', 'c4', ''] }])).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(mergeConversationIds([], [])).toEqual([])
  })
})

describe('readChangelogReplyInput', () => {
  test('a message is all it needs: every linked conversation, with email', () => {
    expect(readChangelogReplyInput({ body: '  Shipped!  ' })).toEqual({ value: { body: 'Shipped!', conversationIds: null, notifyByEmail: true }, errors: [] })
  })

  test('chosen conversations are trimmed and deduplicated; email can be turned off', () => {
    const { value, errors } = readChangelogReplyInput({ body: 'Hi', conversationIds: [' c1 ', 'c1', 'c2', ''], notifyByEmail: false })
    expect(errors).toEqual([])
    expect(value).toEqual({ body: 'Hi', conversationIds: ['c1', 'c2'], notifyByEmail: false })
  })

  test('no message, a wrong shape or too many conversations are refused', () => {
    expect(readChangelogReplyInput({ body: '   ' }).errors).toContain('A message is required')
    expect(readChangelogReplyInput(null).errors).toContain('A message is required')
    expect(readChangelogReplyInput({ body: 'x', conversationIds: 'c1' }).errors).toContain('conversationIds must be an array')
    expect(readChangelogReplyInput({ body: 'x', notifyByEmail: 'yes' }).errors).toContain('notifyByEmail must be true or false')
    const many = Array.from({ length: CHANGELOG_REPLY_SEND_MAX + 1 }, (_, i) => `c${i}`)
    expect(readChangelogReplyInput({ body: 'x', conversationIds: many }).errors[0]).toContain('At most')
  })
})
