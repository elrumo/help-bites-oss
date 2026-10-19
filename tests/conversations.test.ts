import { describe, expect, test } from 'bun:test'
import { buildThreads, groupMessagesForDisplay, replyTarget } from '../shared/conversations'
import { MAX_PAGE_SIZE, PAGE_SIZE, pageHasMore, pageSize } from '../server/utils/conversations'
import { normalizeContext, normalizeSubjectRef, messagePreview, validateFields } from '../shared/support'
import type { Message } from '../shared/support'

function msg(id: string, sender: 'user' | 'agent', createdAt: string, extra: Partial<Message> = {}): Message {
  return { id, conversationId: 'c', sender, senderName: sender === 'agent' ? 'Elías' : 'Ada', body: `body ${id}`, attachments: [], context: null, replyToId: '', clientId: '', createdAt, ...extra }
}

describe('groupMessagesForDisplay', () => {
  test('collapses same-sender runs and breaks on a long gap or a new day', () => {
    const groups = groupMessagesForDisplay([
      msg('1', 'user', '2026-05-01T10:00:00.000Z'),
      msg('2', 'user', '2026-05-01T10:01:00.000Z'),
      msg('3', 'agent', '2026-05-01T10:02:00.000Z'),
      msg('4', 'agent', '2026-05-01T12:30:00.000Z'),
      msg('5', 'user', '2026-05-02T09:00:00.000Z')
    ])
    expect(groups.length).toBe(3)
    expect(groups[0]!.runs.map(r => r.messages.length)).toEqual([2, 1])
    expect(groups[1]!.runs[0]!.messages[0]!.id).toBe('4')
    expect(groups[2]!.startedAt).toBe('2026-05-02T09:00:00.000Z')
  })

  test('unparseable stamps never start a group on their own', () => {
    const groups = groupMessagesForDisplay([msg('1', 'user', '2026-05-01T10:00:00.000Z'), msg('2', 'agent', 'not a date')])
    expect(groups.length).toBe(1)
  })
})

describe('buildThreads', () => {
  test('flattens replies to one level and tolerates missing or cyclic originals', () => {
    const list = [
      msg('a', 'user', '1'),
      msg('b', 'agent', '2', { replyToId: 'a' }),
      msg('c', 'user', '3', { replyToId: 'b' }),
      msg('d', 'user', '4', { replyToId: 'zzz' }),
      msg('e', 'user', '5', { replyToId: 'e' })
    ]
    const { rootOf, replies } = buildThreads(list)
    expect(rootOf.get('b')).toBe('a')
    expect(rootOf.get('c')).toBe('a')
    expect(rootOf.get('d')).toBe('')
    expect(rootOf.get('e')).toBe('')
    expect(replies.get('a')!.map(m => m.id)).toEqual(['b', 'c'])
    expect(replyTarget(list, 'a', 'agent')).toEqual({ id: 'a', name: 'Ada', preview: 'body a' })
    expect(replyTarget(list, 'a', 'user')?.name).toBe('yourself')
    expect(replyTarget(list, 'nope', 'user')).toBeNull()
  })
})

describe('shared helpers', () => {
  test('normalizeContext drops unsafe urls and empty input', () => {
    expect(normalizeContext(null)).toBeNull()
    expect(normalizeContext({})).toBeNull()
    expect(normalizeContext({ type: 'bookmark', id: 'b1', url: 'javascript:alert(1)', thumbnailUrl: 'https://x.io/t.png' })).toEqual({ type: 'bookmark', id: 'b1', label: 'b1', thumbnailUrl: 'https://x.io/t.png' })
  })
  test('typed fields normalize URLs and reject invalid select values', () => {
    const fields = [
      { key: 'reason', label: 'Reason', type: 'select' as const, required: true, options: ['copyright'] },
      { key: 'sourceUrl', label: 'Source URL', type: 'url' as const }
    ]
    expect(validateFields({ reason: 'copyright', sourceUrl: 'javascript:alert(1)' }, fields).errors).toEqual(['Source URL must be an http(s) URL'])
    expect(validateFields({ reason: 'copyright', sourceUrl: 'https://example.com/a' }, fields).values).toEqual({ reason: 'copyright', sourceUrl: 'https://example.com/a' })
    expect(normalizeSubjectRef({ type: 'icon', id: 'i1', label: 'Icon', ownerLabel: 'Ada', url: 'https://example.com' })).toMatchObject({ ownerLabel: 'Ada', type: 'icon' })
  })
  test('messagePreview collapses whitespace and truncates', () => {
    expect(messagePreview('a\n\n  b', 10)).toBe('a b')
    expect(messagePreview('x'.repeat(20), 10)).toBe('xxxxxxxxx…')
  })
})

describe('message paging', () => {
  test('hasMore is judged against the capped page size, not the requested limit', () => {
    const size = pageSize('500')
    expect(size).toBe(MAX_PAGE_SIZE)
    // 300 messages, ?limit=500: a capped page of 200 comes back and there is more.
    expect(pageHasMore(Math.min(300, size), size)).toBe(true)
    expect(pageHasMore(120, size)).toBe(false)
  })
  test('pageSize defaults, floors and clamps junk input', () => {
    for (const junk of [undefined, '', 'abc', 0, NaN]) expect(pageSize(junk)).toBe(PAGE_SIZE)
    expect(pageSize(-5)).toBe(1)
    expect(pageSize('2.9')).toBe(2)
    expect(pageSize(Infinity)).toBe(MAX_PAGE_SIZE)
    expect(pageSize(10)).toBe(10)
  })
})
