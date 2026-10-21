import { beforeEach, describe, expect, test } from 'bun:test'
import { pointerId } from '../server/utils/parse'

// conversationHub.ts leans on nitro's auto-imports and Parse; stub the few it
// calls and run its rules against in-memory rows.

type Fields = Record<string, unknown>
const g = globalThis as Record<string, any>

class FakeRow {
  pending: { op: 'add' | 'remove', field: string, value: string }[] = []
  constructor(public id: string, public fields: Fields = {}) {}
  get(key: string) { return this.fields[key] }
  set(key: string, value: unknown) { this.fields[key] = value }
  addUnique(field: string, value: string) { this.pending.push({ op: 'add', field, value }) }
  remove(field: string, value: string) { this.pending.push({ op: 'remove', field, value }) }
  async save() {
    for (const { op, field, value } of this.pending) {
      const list = (this.fields[field] as string[] | undefined) || []
      this.fields[field] = op === 'add' ? (list.includes(value) ? list : [...list, value]) : list.filter(item => item !== value)
    }
    this.pending = []
  }
}

let conversation: FakeRow
let endUser: FakeRow
let posts: Record<string, FakeRow>
let subscriptions: FakeRow[]
let events: Record<string, unknown>[]
let emitted: { type: string, data: Record<string, unknown> }[]
let followed: string[]
let created: Fields[]
let models: FakeRow[]
let assistants: FakeRow[]
let faqs: FakeRow[]

class Query {
  constructor(private className: string) {}
  equalTo() { return this }
  notEqualTo() { return this }
  containedIn() { return this }
  select() { return this }
  ascending() { return this }
  limit() { return this }
  async find() {
    if (this.className === 'FeedbackSubscription') return subscriptions
    if (this.className === 'KnowledgeModel') return models
    if (this.className === 'SupportAgent') return assistants
    return []
  }
  async get() { return conversation }
}
class FakeFaq extends FakeRow {
  constructor() { super('faq1') }
  async save() { faqs.push(this) }
}

g.MASTER = {}
g.pointerId = pointerId
g.useParse = () => ({ Query, Object: { extend: (name: string) => (name === 'Faq' ? FakeFaq : { createWithoutData: (id: string) => ({ id }) }) } })
g.limitToKeyProjects = (_ctx: unknown, query: unknown) => query
g.resolveAgentFilter = async (id: string) => ({ modelIds: id === 'a1' ? ['m2'] : [] })
g.getFeedbackConfig = () => ({ statuses: [{ key: 'open', label: 'Open', category: 'open' }, { key: 'planned', label: 'Planned', category: 'planned' }] })
g.feedbackPostRef = (row: FakeRow) => ({ id: row.id, number: row.get('number') ?? null, title: String(row.get('title') || ''), status: String(row.get('status') || 'open'), statusCategory: String(row.get('status') || 'open') })
g.findFeedbackPost = async (_project: unknown, id: string) => Object.values(posts).find(post => post.id === id || String(post.get('number')) === id)
g.createFeedbackPostForContact = async (_project: unknown, _contact: unknown, payload: Fields) => {
  if (!endUser.get('externalId')) throw Object.assign(new Error('This contact has no user id'), { statusCode: 409 })
  created.push(payload)
  const post = new FakeRow(`new${created.length}`, { number: 40 + created.length, title: payload.title, status: 'open' })
  posts[post.id] = post
  subscriptions.push(new FakeRow('s', { subscriberId: endUser.get('externalId'), post: { id: post.id }, muted: false }))
  return post
}
g.followFeedbackPost = async (_project: unknown, post: FakeRow, externalId: string) => {
  followed.push(`${post.id}:${externalId}`)
  subscriptions.push(new FakeRow('s', { subscriberId: externalId, post: { id: post.id }, muted: false }))
}
g.appendEvent = async (_conversation: unknown, event: Record<string, unknown>) => { events.push(event) }
g.emitDomainEvent = async (_project: unknown, type: string, data: Record<string, unknown>) => { emitted.push({ type, data }) }

const hub = await import('../server/utils/conversationHub')
const project = { id: 'p1' } as never
const agent = {} as never

beforeEach(() => {
  conversation = new FakeRow('c1', { feedbackPostIds: [] })
  endUser = new FakeRow('u1', { externalId: 'ext1', name: 'Ada' })
  posts = { p10: new FakeRow('p10', { number: 10, title: 'Dark mode', status: 'planned' }), p11: new FakeRow('p11', { number: 11, title: 'CSV export', status: 'open' }) }
  subscriptions = []
  events = []
  emitted = []
  followed = []
  created = []
  models = [new FakeRow('m1', { name: 'General' }), new FakeRow('m2', { name: 'Billing' }), new FakeRow('m3', { name: 'Other project', project: { id: 'p2' } })]
  assistants = [new FakeRow('a0', { name: 'Zero' }), new FakeRow('a1', { name: 'One' })]
  faqs = []
})

const link = (input: Parameters<typeof hub.changeFeedbackLink>[4]) => hub.changeFeedbackLink(project, conversation as never, endUser as never, agent, input)

describe('linking a feedback post', () => {
  test('links an existing post, notes it on the timeline, emits the event and makes the customer follow it', async () => {
    const result = await link({ kind: 'link', postId: '10', linked: true, follow: true })
    expect(result).toMatchObject({ feedbackPostIds: ['p10'], linked: true, created: false, following: true })
    expect(result.post).toEqual({ id: 'p10', number: 10, title: 'Dark mode', status: 'planned', statusLabel: 'Planned', statusCategory: 'planned', following: true })
    expect(conversation.get('feedbackPostIds')).toEqual(['p10'])
    expect(events).toEqual([{ type: 'feedback.linked', postId: 'p10', number: 10, title: 'Dark mode', created: false }])
    expect(emitted).toEqual([{ type: 'conversation.feedback_linked', data: { conversationId: 'c1', contactId: 'u1', postId: 'p10', created: false } }])
    expect(followed).toEqual(['p10:ext1'])
  })

  test('linking twice is a no-op: one line on the timeline, one event', async () => {
    await link({ kind: 'link', postId: 'p10', linked: true, follow: true })
    await link({ kind: 'link', postId: 'p10', linked: true, follow: true })
    expect(conversation.get('feedbackPostIds')).toEqual(['p10'])
    expect(events).toHaveLength(1)
    expect(emitted).toHaveLength(1)
  })

  test('follow: false links without making them follow', async () => {
    const result = await link({ kind: 'link', postId: 'p11', linked: true, follow: false })
    expect(followed).toEqual([])
    expect(result.following).toBe(false)
    expect(result.post.following).toBe(false)
  })

  test('a contact with no user id cannot follow, but the link is still made', async () => {
    endUser.fields.externalId = ''
    const result = await link({ kind: 'link', postId: 'p10', linked: true, follow: true })
    expect(result).toMatchObject({ feedbackPostIds: ['p10'], linked: true, following: false })
    expect(followed).toEqual([])
  })

  test('a muted follow does not count as following', async () => {
    subscriptions.push(new FakeRow('s', { subscriberId: 'ext1', post: { id: 'p10' }, muted: true }))
    const result = await link({ kind: 'link', postId: 'p10', linked: true, follow: false })
    expect(result.following).toBe(false)
  })

  test('an unknown post is a 404 and nothing changes', async () => {
    await expect(link({ kind: 'link', postId: 'nope', linked: true, follow: true })).rejects.toMatchObject({ statusCode: 404 })
    expect(conversation.get('feedbackPostIds')).toEqual([])
    expect(events).toEqual([])
  })

  test('a conversation links at most 20 posts', async () => {
    conversation.fields.feedbackPostIds = Array.from({ length: 20 }, (_, i) => `x${i}`)
    await expect(link({ kind: 'link', postId: 'p10', linked: true, follow: true })).rejects.toMatchObject({ statusCode: 400 })
    await expect(link({ kind: 'create', title: 'One more', body: '', type: '' })).rejects.toMatchObject({ statusCode: 400 })
    expect(created).toEqual([])
  })
})

describe('unlinking', () => {
  test('takes the id off, notes it, emits nothing and leaves the customer following', async () => {
    await link({ kind: 'link', postId: 'p10', linked: true, follow: true })
    events = []
    emitted = []
    const result = await link({ kind: 'link', postId: 'p10', linked: false, follow: true })
    expect(result).toMatchObject({ feedbackPostIds: [], linked: false })
    expect(events).toEqual([{ type: 'feedback.unlinked', postId: 'p10', number: 10, title: 'Dark mode', created: false }])
    expect(emitted).toEqual([])
    expect(result.following).toBe(true)
  })

  test('unlinking what is not linked changes nothing', async () => {
    const result = await link({ kind: 'link', postId: 'p10', linked: false, follow: true })
    expect(result.feedbackPostIds).toEqual([])
    expect(events).toEqual([])
  })

  test('a post deleted since can still be unlinked, by the id as stored', async () => {
    conversation.fields.feedbackPostIds = ['gone']
    const result = await link({ kind: 'link', postId: 'gone', linked: false, follow: true })
    expect(result).toMatchObject({ feedbackPostIds: [], linked: false })
    await expect(link({ kind: 'link', postId: 'gone', linked: true, follow: true })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('filing a post as the customer', () => {
  test('creates it as them, links it, and they follow it as its author', async () => {
    const result = await link({ kind: 'create', title: 'Export bookmarks', body: 'As asked in chat', type: 'feature' })
    expect(created).toEqual([{ title: 'Export bookmarks', body: 'As asked in chat', type: 'feature' }])
    expect(result).toMatchObject({ feedbackPostIds: ['new1'], linked: true, created: true, following: true })
    expect(followed).toEqual([])
    expect(events[0]).toMatchObject({ type: 'feedback.linked', postId: 'new1', created: true })
    expect(emitted[0]).toMatchObject({ type: 'conversation.feedback_linked', data: { postId: 'new1', created: true } })
  })

  test('leaves the type out when none is given', async () => {
    await link({ kind: 'create', title: 'No type', body: '', type: '' })
    expect(created).toEqual([{ title: 'No type', body: '' }])
  })

  test('is refused for a contact with no user id, and links nothing', async () => {
    endUser.fields.externalId = ''
    await expect(link({ kind: 'create', title: 'Nope', body: '', type: '' })).rejects.toMatchObject({ statusCode: 409 })
    expect(conversation.get('feedbackPostIds')).toEqual([])
    expect(events).toEqual([])
  })
})

describe('the AI draft', () => {
  let asked: Record<string, any> | null
  let appended: number
  let rows: { sender: string, body: string, visibility: string, kind: string }[]
  const assistant = new FakeRow('a1', { name: 'Helper' })

  beforeEach(() => {
    asked = null
    appended = 0
    rows = [
      { sender: 'user', body: 'Hi', visibility: 'public', kind: 'message' },
      { sender: 'agent', body: 'Internal: it is the cache', visibility: 'internal', kind: 'message' },
      { sender: 'user', body: 'My export is stuck', visibility: 'public', kind: 'message' }
    ]
    g.resolveDraftAssistant = async () => assistant
    g.resolveAi = async () => ({ metered: false })
    g.assertAiBudget = async () => {}
    g.listMessages = async () => ({ rows, hasMore: false })
    g.serializeMessage = (row: unknown) => row
    g.retrieveKnowledge = async () => [{ faqId: 'f1', question: 'Exports', answer: 'Wait a minute', score: 0.9 }]
    g.generateAnswer = async (input: Record<string, any>) => { asked = input; return { text: 'Hi! Exports can take a minute.', model: 'test-model' } }
    g.appendMessage = async () => { appended++ }
  })

  const draft = () => hub.draftReply({} as never, project, conversation as never)

  test('answers the latest customer message from the public transcript, and stores nothing', async () => {
    const result = await draft()
    expect(result).toEqual({ draft: 'Hi! Exports can take a minute.', model: 'test-model', sources: [{ faqId: 'f1', question: 'Exports' }] })
    expect(asked!.query).toBe('My export is stuck')
    expect(asked!.transcript).toEqual([{ sender: 'user', body: 'Hi' }])
    expect(JSON.stringify(asked!.transcript)).not.toContain('cache')
    expect(appended).toBe(0)
  })

  test('409 when the project has no assistant, no AI, or the customer has not written', async () => {
    g.resolveDraftAssistant = async () => null
    await expect(draft()).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('no assistant') })
    g.resolveDraftAssistant = async () => assistant
    g.resolveAi = async () => null
    await expect(draft()).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('No AI') })
    g.resolveAi = async () => ({ metered: false })
    rows = [{ sender: 'agent', body: 'We wrote first', visibility: 'public', kind: 'message' }]
    await expect(draft()).rejects.toMatchObject({ statusCode: 409 })
  })

  test('a spent AI budget passes through as the 402 it is', async () => {
    g.assertAiBudget = async () => { throw Object.assign(new Error('plan limit'), { statusCode: 402 }) }
    await expect(draft()).rejects.toMatchObject({ statusCode: 402 })
    expect(asked).toBeNull()
  })

  test('a failing provider is a 502, but a status it already carries is kept', async () => {
    g.generateAnswer = async () => { throw new Error('LLM endpoint returned 500') }
    await expect(draft()).rejects.toMatchObject({ statusCode: 502, statusMessage: expect.stringContaining('LLM endpoint') })
    g.generateAnswer = async () => { throw Object.assign(new Error('credits'), { statusCode: 402 }) }
    await expect(draft()).rejects.toMatchObject({ statusCode: 402 })
  })
})

describe('saving an answer as an FAQ', () => {
  let indexed: string[]
  let gauge: string[]
  const ctx = { workspace: { id: 'w1' }, agentId: 'agent1' } as never
  const input = { modelId: '', question: 'How do I export?', answer: 'Open Settings, then Export.' }

  beforeEach(() => {
    indexed = []
    gauge = []
    g.scoped = { knowledgeModel: async (_ctx: unknown, id: string) => models.find(model => model.id === id) || Promise.reject(Object.assign(new Error('Knowledge model not found'), { statusCode: 404 })) }
    g.checkGauge = async (_workspace: unknown, metric: string) => { gauge.push(metric) }
    g.queueKnowledgeIndex = async (id: string) => { indexed.push(id) }
    g.applyFaqInput = (faq: FakeRow, body: Record<string, string>) => { faq.set('question', body.question); faq.set('answer', body.answer) }
  })

  const save = (body = input) => hub.saveConversationFaq(ctx, project, conversation as never, body)

  test('writes an active FAQ that remembers its conversation, in the model the conversation\'s assistant reads', async () => {
    conversation.fields.assistantId = 'a1'
    await save()
    expect(faqs).toHaveLength(1)
    const faq = faqs[0]!
    expect(faq.fields).toMatchObject({ origin: 'conversation', conversationId: 'c1', status: 'active', needsReindex: true, question: 'How do I export?', answer: 'Open Settings, then Export.' })
    expect((faq.get('knowledgeModel') as FakeRow).id).toBe('m2')
    expect(gauge).toEqual(['faqs'])
    expect(indexed).toEqual(['m2'])
  })

  test('the operator can pick another model of the project, but not one pinned elsewhere', async () => {
    await save({ ...input, modelId: 'm1' })
    expect((faqs[0]!.get('knowledgeModel') as FakeRow).id).toBe('m1')
    await expect(save({ ...input, modelId: 'm3' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(save({ ...input, modelId: 'nope' })).rejects.toMatchObject({ statusCode: 404 })
    expect(faqs).toHaveLength(1)
  })

  test('says so plainly when the workspace has no knowledge model', async () => {
    models = []
    await expect(save()).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('no knowledge model') })
    expect(faqs).toEqual([])
  })

  test('respects the plan\'s FAQ limit', async () => {
    g.checkGauge = async () => { throw Object.assign(new Error('plan limit'), { statusCode: 402 }) }
    await expect(save()).rejects.toMatchObject({ statusCode: 402 })
    expect(faqs).toEqual([])
  })
})
