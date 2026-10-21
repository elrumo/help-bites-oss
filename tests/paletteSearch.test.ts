import { describe, expect, test } from 'bun:test'
import { MIN_SEARCH_LENGTH, conversationHits, faqHitsOf, hasSearchTerm, type SearchHits } from '../app/utils/paletteSearch'
import { demoApi } from '../app/utils/demoApi'

const labels = { project: (id: string) => (id === 'acme' ? 'Acme' : ''), unknownCustomer: 'Unknown customer' }

describe('⌘K content search', () => {
  test('a term is worth searching from two characters, ignoring the spaces around it', () => {
    expect(MIN_SEARCH_LENGTH).toBe(2)
    expect(hasSearchTerm(' a ')).toBe(false)
    expect(hasSearchTerm(' ab ')).toBe(true)
    expect(hasSearchTerm('')).toBe(false)
  })

  test('a conversation shows who wrote, in which project, and what it is about', () => {
    const hits = {
      conversations: [
        { id: 'c1', projectId: 'acme', endUserId: 'u1', subject: '', lastMessagePreview: 'The   export button\ndoes nothing' },
        { id: 'c2', projectId: 'gone', endUserId: 'missing', subject: 'Refund', lastMessagePreview: 'ignored when there is a subject' }
      ],
      endUsers: { u1: { name: '', email: 'maya@example.com', externalId: 'u_1' } },
      faqs: []
    } as unknown as SearchHits
    expect(conversationHits(hits, labels)).toEqual([
      { id: 'c:c1', label: 'maya@example.com', suffix: 'Acme · The export button does nothing', icon: 'i-lucide-message-square', to: '/inbox?c=c1' },
      { id: 'c:c2', label: 'Unknown customer', suffix: 'Refund', icon: 'i-lucide-message-square', to: '/inbox?c=c2' }
    ])
  })

  test('a long answer is cut to a line, and opens its knowledge model', () => {
    const [hit] = faqHitsOf({ conversations: [], endUsers: {}, faqs: [{ id: 'f1', modelId: 'm1', question: 'How do I export?', answer: 'x'.repeat(300) }] } as unknown as SearchHits)
    expect(hit!.to).toBe('/knowledge/models/m1')
    expect(hit!.suffix.length).toBe(90)
    expect(hit!.suffix.endsWith('…')).toBe(true)
  })

  test('nothing found, or search not available, is an empty list', () => {
    expect(conversationHits(null, labels)).toEqual([])
    expect(faqHitsOf(null)).toEqual([])
  })

  test('the demo answers the search like the server does, so the palette works there too', async () => {
    const found = await demoApi<SearchHits>('/admin/search', { query: { q: 'export' } })
    expect(found.conversations.length).toBeGreaterThan(0)
    expect(found.conversations.every(c => found.endUsers[c.endUserId])).toBe(true)
    expect(await demoApi<SearchHits>('/admin/search', { query: { q: 'zzzz-nothing' } })).toEqual({ conversations: [], endUsers: {}, faqs: [] })
  })
})
