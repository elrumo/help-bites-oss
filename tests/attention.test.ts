import { describe, expect, test } from 'bun:test'
import { ATTENTION_KINDS, attentionTotal, sortAttention, type AttentionItem } from '../shared/attention'

const item = (kind: AttentionItem['kind'], at: string | null, count = 1, key = `${kind}:p1`): AttentionItem => ({ key, kind, projectId: 'p1', count, value: '', detail: '', section: 'x', at })

describe('needs attention', () => {
  test('the newest first, then by kind, then by key, so an unchanged list keeps its order', () => {
    const rows = [item('bounces', '2026-10-20T00:00:00Z'), item('drafts', '2026-10-21T00:00:00Z'), item('alerts', null), item('errors', null), item('sync', '2026-10-21T00:00:00Z', 1, 'sync:b'), item('sync', '2026-10-21T00:00:00Z', 1, 'sync:a')]
    expect(sortAttention(rows).map(r => r.key)).toEqual(['drafts:p1', 'sync:a', 'sync:b', 'bounces:p1', 'alerts:p1', 'errors:p1'])
    expect(sortAttention(sortAttention(rows))).toEqual(sortAttention(rows))
    expect(rows[0]!.kind).toBe('bounces')
  })

  test('the badge is the sum of what each row covers', () => {
    expect(attentionTotal([item('drafts', null, 3), item('bounces', null, 12), item('sync', null, 1)])).toBe(16)
    expect(attentionTotal([])).toBe(0)
  })

  test('every kind is named once', () => {
    expect(new Set(ATTENTION_KINDS).size).toBe(ATTENTION_KINDS.length)
  })
})
