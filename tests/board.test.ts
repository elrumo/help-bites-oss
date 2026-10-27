import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_BOARD_CONFIG,
  normalizeBoardConfig,
  rankBetween,
  readBoardItemInput,
  roadmapGroups,
  toRoadmapItem,
  validateBoardConfig,
  type BoardConfig,
  type BoardItem
} from '../shared/board'

const config: BoardConfig = { ...DEFAULT_BOARD_CONFIG, enabled: true, labels: [{ key: 'editor', label: 'Editor', color: 'info' }, { key: 'api', label: 'API', color: 'neutral' }] }

const item = (fields: Partial<BoardItem> = {}): BoardItem => ({
  id: 'item1',
  projectId: 'p1',
  number: 7,
  title: 'CSV export',
  description: 'Internal: the importer needs a rewrite first',
  publicDescription: 'Export your library as CSV',
  status: 'planned',
  statusCategory: 'planned',
  rank: 1,
  priority: 'high',
  assigneeId: 'agent1',
  labels: ['editor'],
  attachments: [],
  targetDate: '2026-08-15T00:00:00.000Z',
  public: true,
  feedbackPostIds: ['post1', 'post2'],
  conversationIds: ['conv1'],
  relatedItemIds: [],
  related: [],
  errorRefs: [],
  voteCount: 0,
  posts: [],
  conversations: [{ id: 'conv1', subject: 'Help', status: 'open', endUserName: 'Ada' }],
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lastModifiedBy: '',
  lastModifiedSource: '',
  ...fields
})

const post = (id: string, voteCount: number, hidden = false) => ({ id, number: 1, title: id, status: 'planned', statusCategory: 'planned' as const, voteCount, hidden })

describe('board config', () => {
  test('defaults: five statuses with Backlog the default, sync off, columns', () => {
    const read = normalizeBoardConfig(undefined)
    expect(read.enabled).toBe(false)
    expect(read.syncFeedback).toBe(false)
    expect(read.roadmap).toEqual({ layout: 'columns', showLabels: false, showDates: false })
    expect(read.statuses.map(s => s.category)).toEqual(['open', 'planned', 'active', 'done', 'closed'])
    expect(read.statuses.find(s => s.isDefault)?.key).toBe('backlog')
    expect(normalizeBoardConfig({ statuses: 'nonsense' }).statuses).toEqual(DEFAULT_BOARD_CONFIG.statuses)
  })

  test('statuses and labels go through the feedback validation, with labels named as such', () => {
    const { errors } = validateBoardConfig({ statuses: [{ key: 'a', category: 'someday' }], labels: [{ key: 'x' }, { key: 'x' }] })
    expect(errors.some(e => e.includes('category'))).toBe(true)
    expect(errors).toContain('labels: duplicate key "x"')
    const { config: next, errors: none } = validateBoardConfig({ labels: [{ key: 'Design', label: 'Design', color: 'warning' }] }, config)
    expect(none).toEqual([])
    expect(next.labels).toEqual([{ key: 'design', label: 'Design', color: 'warning' }])
    expect(next.statuses).toEqual(config.statuses)
  })

  test('a partial nested roadmap merges key by key over the base', () => {
    const base = { ...config, roadmap: { layout: 'timeline' as const, showLabels: true, showDates: false } }
    const { config: next, errors } = validateBoardConfig({ roadmap: { showDates: true } }, base)
    expect(errors).toEqual([])
    expect(next.roadmap).toEqual({ layout: 'timeline', showLabels: true, showDates: true })
    expect(next.enabled).toBe(true)
    expect(validateBoardConfig({ roadmap: { layout: 'gantt' } }, base).errors[0]).toContain('roadmap.layout')
    expect(validateBoardConfig({ roadmap: 'columns' }).errors).toContain('roadmap must be an object')
    expect(validateBoardConfig({ syncFeedback: 1 }).config.syncFeedback).toBe(true)
  })
})

describe('item input', () => {
  test('a title is required on create, and public defaults to false', () => {
    expect(readBoardItemInput({}, config, { create: true }).errors).toContain('A title is required')
    expect(readBoardItemInput({ title: '  Dark mode  ' }, config, { create: true })).toEqual({ values: { title: 'Dark mode', public: false }, errors: [] })
    expect(readBoardItemInput({ status: 'done' }, config, { create: false }).values).toEqual({ status: 'done' })
    expect(readBoardItemInput({ title: 'x'.repeat(201) }, config, { create: true }).errors[0]).toContain('longer than 200')
  })

  test('statuses and labels must be ones the board defines', () => {
    expect(readBoardItemInput({ status: 'someday' }, config, { create: false }).errors).toContain('Unknown status: someday')
    expect(readBoardItemInput({ labels: ['editor', 'nope'] }, config, { create: false }).errors).toContain('Unknown label: nope')
    expect(readBoardItemInput({ labels: ['Editor', 'editor'] }, config, { create: false }).values.labels).toEqual(['editor'])
    expect(readBoardItemInput({ labels: null }, config, { create: false }).values.labels).toEqual([])
  })

  test('priority is one of the conversation priorities, or empty', () => {
    expect(readBoardItemInput({ priority: 'asap' }, config, { create: false }).errors[0]).toContain('priority')
    expect(readBoardItemInput({ priority: 'urgent' }, config, { create: false }).values.priority).toBe('urgent')
    expect(readBoardItemInput({ priority: null }, config, { create: false }).values.priority).toBe('')
  })

  test('dates, ranks and assignees are checked for shape', () => {
    expect(readBoardItemInput({ targetDate: '2026-07-01' }, config, { create: false }).values.targetDate?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(readBoardItemInput({ targetDate: null }, config, { create: false }).values.targetDate).toBeNull()
    expect(readBoardItemInput({ targetDate: 'soon' }, config, { create: false }).errors).toContain('targetDate is not a valid date')
    expect(readBoardItemInput({ rank: Number.POSITIVE_INFINITY }, config, { create: false }).errors).toContain('rank must be a finite number')
    expect(readBoardItemInput({ rank: '3' }, config, { create: false }).errors).toContain('rank must be a finite number')
    expect(readBoardItemInput({ rank: 2.5 }, config, { create: false }).values.rank).toBe(2.5)
    expect(readBoardItemInput({ assigneeId: null }, config, { create: false }).values.assigneeId).toBe('')
  })
})

describe('ranks', () => {
  test('the midpoint between neighbours, one step past a single one, 0 alone', () => {
    expect(rankBetween(1, 2)).toBe(1.5)
    expect(rankBetween(undefined, 10)).toBe(9)
    expect(rankBetween(10, undefined)).toBe(11)
    expect(rankBetween()).toBe(0)
    expect(rankBetween(Number.NaN, 4)).toBe(3)
  })

  test('repeated inserts at the same spot keep a strict order for a long while', () => {
    const before = 1000
    let after = 1001
    for (let i = 0; i < 40; i++) {
      const rank = rankBetween(before, after)
      expect(rank).toBeGreaterThan(before)
      expect(rank).toBeLessThan(after)
      after = rank
    }
  })
})

describe('roadmap', () => {
  test('a public item carries only its allow-listed fields', () => {
    const out = toRoadmapItem(item(), [post('post1', 3)], config.roadmap)
    expect(Object.keys(out).sort()).toEqual(['completedAt', 'description', 'id', 'posts', 'status', 'statusCategory', 'title', 'updatedAt', 'voteCount'])
    expect(out.description).toBe('Export your library as CSV')
    const json = JSON.stringify(out)
    for (const leak of ['Internal', 'agent1', 'high', 'conv1', 'Ada', '"number":7', 'assignee', 'priority', 'rank', 'conversationIds', 'feedbackPostIds', 'hidden']) expect(json).not.toContain(leak)
  })

  test('the internal description never stands in for a missing public one', () => {
    expect(toRoadmapItem(item({ publicDescription: '' }), [], config.roadmap).description).toBe('')
  })

  test('hidden posts are dropped and stop counting', () => {
    const out = toRoadmapItem(item(), [post('post1', 3), post('post2', 5, true)], config.roadmap)
    expect(out.voteCount).toBe(3)
    expect(out.posts.map(p => p.id)).toEqual(['post1'])
  })

  test('labels and dates go out only when the board says so', () => {
    expect(toRoadmapItem(item(), [], { layout: 'columns', showLabels: true, showDates: false }).labels).toEqual(['editor'])
    expect(toRoadmapItem(item(), [], { layout: 'columns', showLabels: false, showDates: true }).targetDate).toBe('2026-08-15T00:00:00.000Z')
    expect('targetDate' in toRoadmapItem(item(), [], { layout: 'timeline', showLabels: false, showDates: false })).toBe(true)
    expect('targetDate' in toRoadmapItem(item(), [], { layout: 'list', showLabels: false, showDates: false })).toBe(false)
  })

  test('columns and list group by status, in the board order, empty ones included', () => {
    const statuses = config.statuses.filter(s => ['planned', 'active', 'done'].includes(s.category))
    const groups = roadmapGroups([{ id: 'a', status: 'done' }, { id: 'b', status: 'planned' }, { id: 'c', status: 'planned' }], statuses, 'columns')
    expect(groups.map(g => [g.key, g.items.map(i => i.id)])).toEqual([['planned', ['b', 'c']], ['in-progress', []], ['done', ['a']]])
    expect(roadmapGroups([], statuses, 'list').map(g => g.label)).toEqual(['Planned', 'In progress', 'Done'])
  })

  test('the timeline groups by target quarter, soonest first, with no date last', () => {
    const cards = [
      { id: 'late', status: 'planned', targetDate: '2027-01-10T00:00:00.000Z' },
      { id: 'none', status: 'planned', targetDate: null },
      { id: 'q3b', status: 'done', targetDate: '2026-09-30T00:00:00.000Z' },
      { id: 'q3a', status: 'planned', targetDate: '2026-07-01T00:00:00.000Z' },
      { id: 'bad', status: 'planned', targetDate: 'whenever' }
    ]
    const groups = roadmapGroups(cards, config.statuses, 'timeline')
    expect(groups.map(g => g.label)).toEqual(['Q3 2026', 'Q1 2027', 'No date'])
    expect(groups[0]!.items.map(i => i.id)).toEqual(['q3a', 'q3b'])
    expect(groups.at(-1)!.items.map(i => i.id).sort()).toEqual(['bad', 'none'])
  })
})
