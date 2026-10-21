import { describe, expect, test } from 'bun:test'
import { cleanEventFilters, DOMAIN_EVENTS, isEventFilter, LEGACY_WEBHOOK_EVENTS, matchesEventFilter } from '../shared/domainEvents'

describe('event filters', () => {
  test('* matches everything, group.* a group, a type only itself', () => {
    expect(matchesEventFilter('feedback.post.voted', ['*'])).toBe(true)
    expect(matchesEventFilter('feedback.post.voted', ['feedback.*'])).toBe(true)
    expect(matchesEventFilter('feedback.post.voted', ['feedback.post.created'])).toBe(false)
    expect(matchesEventFilter('feedback.post.voted', ['board.*', 'feedback.post.voted'])).toBe(true)
    // A group prefix never matches a longer group name.
    expect(matchesEventFilter('cms.entry.published', ['c.*'])).toBe(false)
    expect(matchesEventFilter('contact.created', ['conversation.*'])).toBe(false)
  })

  test('filters are validated: known events and groups only, empty means everything', () => {
    expect(cleanEventFilters(undefined)).toEqual({ filters: ['*'], errors: [] })
    expect(cleanEventFilters([])).toEqual({ filters: ['*'], errors: [] })
    expect(cleanEventFilters(['changelog.*', 'changelog.*', ' github.pull_request.merged '])).toEqual({ filters: ['changelog.*', 'github.pull_request.merged'], errors: [] })
    expect(cleanEventFilters(['nope.*']).errors).toHaveLength(1)
    expect(cleanEventFilters(['feedback.post.exploded']).errors).toHaveLength(1)
    expect(cleanEventFilters('feedback.*').errors).toHaveLength(1)
    expect(isEventFilter('webhook.test')).toBe(false)
  })

  test('the catalogue is unique and the legacy webhook keeps only events that exist', () => {
    const types = DOMAIN_EVENTS.map(e => e.type)
    expect(new Set(types).size).toBe(types.length)
    expect(LEGACY_WEBHOOK_EVENTS.filter(t => !types.includes(t))).toEqual([])
    for (const e of DOMAIN_EVENTS) expect(e.type.startsWith(`${e.group}.`)).toBe(true)
  })
})

describe('the in-process bus', () => {
  test('handlers matching the event run, each isolated from the others', async () => {
    const { emitDomainEvent, onDomainEvent } = await import('../server/utils/domainEvents')
    const seen: string[] = []
    const quiet = console.error
    console.error = () => {}
    try {
      onDomainEvent('test-throws', 'board.*', () => { throw new Error('boom') })
      onDomainEvent('test-board', 'board.item.created', (e, p) => { seen.push(`${e.type}:${e.projectId}:${p.id}`) })
      onDomainEvent('test-other', 'feedback.*', () => { seen.push('wrong') })
      const event = await emitDomainEvent({ id: 'p1' } as never, 'board.item.created', { itemId: 'i1' })
      expect(seen).toEqual(['board.item.created:p1:p1'])
      expect(event.id).toMatch(/^evt_[0-9a-f]{24}$/)
      expect(event.data).toEqual({ itemId: 'i1' })
      // Registering a name again replaces it rather than doubling up.
      onDomainEvent('test-board', 'board.item.created', () => { seen.push('second') })
      await emitDomainEvent({ id: 'p1' } as never, 'board.item.created', {})
      expect(seen).toEqual(['board.item.created:p1:p1', 'second'])
    } finally {
      console.error = quiet
    }
  })
})
