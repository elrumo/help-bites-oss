import { beforeEach, describe, expect, test } from 'bun:test'
import { iso, pointerId } from '../server/utils/parse'

// conversations.ts leans on nitro's auto-imports and Parse; run its write paths
// against in-memory rows and watch which domain events they publish.

type Fields = Record<string, unknown>
const g = globalThis as Record<string, any>

class FakeRow {
  static counter = 0
  id = `r${++FakeRow.counter}`
  createdAt = new Date('2026-01-01T00:00:00.000Z')
  fields: Fields = {}
  get(key: string) { return this.fields[key] }
  set(key: string, value: unknown) { this.fields[key] = value }
  unset(key: string) { delete this.fields[key] }
  async save() {}
}

let emitted: { project: unknown, type: string, data: Record<string, unknown> }[]
let published: Record<string, unknown>[]

class Query {
  equalTo() { return this }
  async first() { return null }
}

g.MASTER = {}
g.iso = iso
g.pointerId = pointerId
g.useParse = () => ({ Query, Object: { extend: () => FakeRow } })
g.publishEvent = async (event: Record<string, unknown>) => { published.push(event) }
g.emitDomainEventLater = (project: unknown, type: string, data: Record<string, unknown>) => { emitted.push({ project, type, data }) }
g.syncConversationForSearch = async () => {}

const conversations = await import('../server/utils/conversations')

const project = { id: 'p1' } as never
const endUser = Object.assign(new FakeRow(), { id: 'u1' })
endUser.fields = { externalId: 'ext1', email: 'ada@example.com' }
const agent = Object.assign(new FakeRow(), { id: 'a1' })

function open(status = 'open') {
  const row = new FakeRow()
  row.id = 'c1'
  row.fields = { project, endUser, type: 'support', status, statusCategory: status === 'done' ? 'resolved' : 'open' }
  return row as never
}

beforeEach(() => {
  emitted = []
  published = []
})

describe('conversation.status_changed', () => {
  test('setStatus publishes it once, with where the status went', async () => {
    await conversations.setStatus(open(), 'done')
    expect(emitted).toEqual([{ project, type: 'conversation.status_changed', data: { conversationId: 'c1', from: 'open', to: 'done', statusCategory: 'resolved' } }])
  })

  test('setting the status it already has publishes nothing', async () => {
    await conversations.setStatus(open('done'), 'done')
    expect(emitted).toEqual([])
  })

  test('a triage edit that moves the status publishes it; one that does not, does not', async () => {
    await conversations.updateConversation(open(), { status: 'done' }, agent as never)
    expect(emitted.map(e => e.data)).toEqual([{ conversationId: 'c1', from: 'open', to: 'done', statusCategory: 'resolved' }])
    emitted = []
    await conversations.updateConversation(open(), { priority: 'high' }, agent as never)
    expect(emitted).toEqual([])
  })

  test('a customer writing into a done conversation reopens it, and that is a status change', async () => {
    const input = { body: 'Still broken', replyToId: '', clientId: '', attachments: [], context: null }
    await conversations.appendMessage({ conversation: open('done'), sender: 'user', senderName: 'Ada', input })
    expect(emitted.map(e => e.type)).toEqual(['conversation.status_changed'])
    expect(emitted[0]!.data).toMatchObject({ from: 'done', to: 'open', statusCategory: 'open' })
  })

  test('an agent reply, or a customer message into an open conversation, changes no status', async () => {
    const input = { body: 'Hello', replyToId: '', clientId: '', attachments: [], context: null }
    await conversations.appendMessage({ conversation: open('done'), sender: 'agent', senderName: 'Sam', input })
    await conversations.appendMessage({ conversation: open(), sender: 'user', senderName: 'Ada', input })
    expect(emitted).toEqual([])
  })
})

describe('conversation.created', () => {
  test('is published when a conversation is made, with the contact and the type', async () => {
    const row = await conversations.createConversation(project, endUser as never, 'Help', null, {}, 'agent')
    expect(emitted).toEqual([{ project, type: 'conversation.created', data: { conversationId: row.id, contact: { id: 'u1', externalId: 'ext1', email: 'ada@example.com' }, type: 'support' } }])
  })
})
