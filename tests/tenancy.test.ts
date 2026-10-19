import { beforeEach, describe, expect, test } from 'bun:test'
import { pointerId } from '../server/utils/parse'

// tenancy.ts leans on nitro's auto-imports; stub them before loading it.
type Row = { id: string, fields: Record<string, unknown>, get(key: string): unknown }
const row = (id: string, fields: Record<string, unknown> = {}): Row => ({ id, fields, get: (key: string) => fields[key] })

let memberships: { user: string, workspace: string, role: string }[] = []
let workspaces: Record<string, Row> = {}
let projects: Record<string, Row> = {}
let identity: Record<string, unknown> = {}

const g = globalThis as Record<string, unknown>
g.onInvalidate = () => {}
g.invalidate = async () => {}
g.pointerId = pointerId
g.MASTER = {}
g.requireAgentIdentity = async () => identity
g.loadProjectUnscoped = async (id: string) => {
  if (!projects[id]) throw Object.assign(new Error('Project not found'), { statusCode: 404 })
  return projects[id]
}
class Query {
  constructor(private className: string) {}
  private filters: Record<string, unknown> = {}
  equalTo(key: string, value: unknown) { this.filters[key] = value; return this }
  ascending() { return this }
  select() { return this }
  limit() { return this }
  async find() {
    if (this.className === 'WorkspaceMember') return memberships.filter(m => m.user === pointerId(this.filters.user)).map(m => row(`${m.user}:${m.workspace}`, { workspace: { id: m.workspace }, role: m.role }))
    return []
  }
  async get(id: string) {
    if (this.className === 'Workspace' && workspaces[id]) return workspaces[id]
    if (this.className === 'KnowledgeModel' && models[id]) return models[id]
    if (this.className === 'Project' && projects[id]) return projects[id]
    throw new Error('not found')
  }
}
let models: Record<string, Row> = {}
const missing = (what: string) => Object.assign(new Error(what), { statusCode: 404 })
const rows: Record<string, Row> = {}
g.getConversation = async (id: string) => rows[id] || Promise.reject(missing('Conversation not found'))
g.getEmailTemplate = async (id: string) => rows[id] || Promise.reject(missing('Email template not found'))
g.getKnowledgeModelById = async (id: string) => models[id] || Promise.reject(missing('Knowledge model not found'))
g.getKnowledgeNodeById = async (id: string) => rows[id] || Promise.reject(missing('Node not found'))
g.useParse = () => ({ Query, User: { createWithoutData: (id: string) => ({ id }) }, Object: { extend: () => ({ createWithoutData: (id: string) => ({ id }) }) } })

const tenancy = await import('../server/utils/tenancy')
const { chooseWorkspaceId, requireMember, requireProject } = tenancy
Object.assign(g, tenancy)
const { scoped } = await import('../server/utils/scoped')

const event = (headers: Record<string, string> = {}) => ({ context: {}, node: { req: { headers } } }) as any
const agent = (id: string, defaultWorkspace = '') => row(id, defaultWorkspace ? { defaultWorkspace: { id: defaultWorkspace } } : {})

beforeEach(() => {
  memberships = [
    { user: 'ada', workspace: 'W1', role: 'owner' },
    { user: 'ada', workspace: 'W2', role: 'agent' },
    { user: 'bob', workspace: 'W2', role: 'admin' }
  ]
  workspaces = { W1: row('W1', { name: 'One', status: 'active' }), W2: row('W2', { name: 'Two', status: 'active' }), W3: row('W3', { name: 'Gone', status: 'suspended' }) }
  projects = { P1: row('P1', { workspace: { id: 'W1' } }), P2: row('P2', { workspace: { id: 'W2' } }) }
  models = { M1: row('M1', { workspace: { id: 'W1' } }), M3: row('M3', { workspace: { id: 'W1' }, project: { id: 'P1' } }), M2: row('M2', { workspace: { id: 'W2' } }) }
  Object.assign(rows, {
    C1: row('C1', { project: { id: 'P1' } }), C2: row('C2', { project: { id: 'P2' } }),
    T1: row('T1', { workspace: { id: 'W1' } }), T2: row('T2', { workspace: { id: 'W2' } }),
    N1: row('N1', { knowledgeModel: { id: 'M1' } }), N3: row('N3', { knowledgeModel: { id: 'M3' } }), N2: row('N2', { knowledgeModel: { id: 'M2' } })
  })
  identity = { agent: agent('ada'), agentId: 'ada', sessionToken: 'r:x', apiKeyId: '', apiKeyWorkspaceId: '' }
})

describe('chooseWorkspaceId', () => {
  const ms = [{ workspaceId: 'W1', role: 'owner' as const }, { workspaceId: 'W2', role: 'agent' as const }]

  test('an API key only ever acts in its own workspace', () => {
    expect(chooseWorkspaceId({ header: '', apiKeyWorkspaceId: 'W2', memberships: ms, defaultWorkspaceId: 'W1' })).toEqual({ workspaceId: 'W2' })
    expect(chooseWorkspaceId({ header: 'W1', apiKeyWorkspaceId: 'W2', memberships: ms, defaultWorkspaceId: '' })).toEqual({ error: 'key_mismatch' })
  })

  test('then the header, then the only one, the default, the oldest', () => {
    expect(chooseWorkspaceId({ header: 'W9', apiKeyWorkspaceId: '', memberships: ms, defaultWorkspaceId: '' })).toEqual({ workspaceId: 'W9' })
    expect(chooseWorkspaceId({ header: '', apiKeyWorkspaceId: '', memberships: [ms[1]!], defaultWorkspaceId: 'W1' })).toEqual({ workspaceId: 'W2' })
    expect(chooseWorkspaceId({ header: '', apiKeyWorkspaceId: '', memberships: ms, defaultWorkspaceId: 'W2' })).toEqual({ workspaceId: 'W2' })
    expect(chooseWorkspaceId({ header: '', apiKeyWorkspaceId: '', memberships: ms, defaultWorkspaceId: 'W7' })).toEqual({ workspaceId: 'W1' })
    expect(chooseWorkspaceId({ header: '', apiKeyWorkspaceId: '', memberships: [], defaultWorkspaceId: '' })).toEqual({ error: 'none' })
  })
})

describe('requireMember', () => {
  test('acts in the workspace named by the header, with the role held there', async () => {
    const ctx = await requireMember(event({ 'x-workspace': 'W2' }))
    expect(ctx.workspaceId).toBe('W2')
    expect(ctx.role).toBe('agent')
  })

  test('a workspace you are not in is refused, as is one you name with someone else\'s key', async () => {
    identity = { ...identity, agent: agent('bob'), agentId: 'bob' }
    await expect(requireMember(event({ 'x-workspace': 'W1' }))).rejects.toMatchObject({ statusCode: 403, data: { code: 'not_member' } })
    identity = { ...identity, agent: agent('ada'), agentId: 'ada', sessionToken: 'ak_x', apiKeyWorkspaceId: 'W1' }
    await expect(requireMember(event({ 'x-workspace': 'W2' }))).rejects.toMatchObject({ statusCode: 403 })
  })

  test('the role check refuses what the role cannot do', async () => {
    await expect(requireMember(event({ 'x-workspace': 'W2' }), { can: 'team.manage' })).rejects.toMatchObject({ statusCode: 403, data: { code: 'forbidden_role' } })
    expect((await requireMember(event({ 'x-workspace': 'W1' }), { can: 'billing' })).role).toBe('owner')
  })

  test('a suspended workspace is refused unless the route reads it anyway', async () => {
    // A user of its own: memberships are cached per user for a minute.
    memberships.push({ user: 'cy', workspace: 'W3', role: 'owner' })
    identity = { ...identity, agent: agent('cy'), agentId: 'cy' }
    await expect(requireMember(event({ 'x-workspace': 'W3' }))).rejects.toMatchObject({ data: { code: 'workspace_suspended' } })
    expect((await requireMember(event({ 'x-workspace': 'W3' }), { allowInactive: true })).workspaceId).toBe('W3')
  })
})

describe('requireProject', () => {
  test('a project of another workspace looks like no project at all', async () => {
    const ctx = await requireMember(event({ 'x-workspace': 'W1' }))
    expect((await requireProject(ctx, 'P1')).id).toBe('P1')
    await expect(requireProject(ctx, 'P2')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireProject(ctx, 'nope')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('an API key limited to some projects', () => {
  async function limited() {
    identity = { ...identity, sessionToken: 'ak_x', apiKeyWorkspaceId: 'W1', apiKeyProjectIds: ['P1'] }
    return await requireMember(event({}))
  }

  test('reaches only its projects, and only what hangs off them', async () => {
    const ctx = await limited()
    expect((await requireProject(ctx, 'P1')).id).toBe('P1')
    expect((await scoped.conversation(ctx, 'C1')).id).toBe('C1')
    identity = { ...identity, apiKeyProjectIds: ['P9'] }
    const other = await requireMember(event({ 'x-workspace': 'W1' }))
    await expect(requireProject(other, 'P1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(scoped.conversation(other, 'C1')).rejects.toMatchObject({ statusCode: 404 })
  })

  test('reaches the knowledge of its projects, not the workspace\'s shared knowledge', async () => {
    const ctx = await limited()
    expect((await scoped.knowledgeModel(ctx, 'M3')).id).toBe('M3')
    expect((await scoped.knowledgeNode(ctx, 'N3')).id).toBe('N3')
    await expect(scoped.knowledgeModel(ctx, 'M1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(scoped.knowledgeNode(ctx, 'N1')).rejects.toMatchObject({ statusCode: 404 })
    expect((await requireMember(event({}), { can: 'assistants.manage' })).workspaceId).toBe('W1')
  })

  test('is refused the workspace itself: its own rows, workspace-level actions and routes', async () => {
    const ctx = await limited()
    await expect(scoped.emailTemplate(ctx, 'T1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireMember(event({}), { can: 'apiKeys.manage' })).rejects.toMatchObject({ statusCode: 403, data: { code: 'key_project_scope' } })
    await expect(requireMember(event({}), { workspaceWide: true })).rejects.toMatchObject({ statusCode: 403, data: { code: 'key_project_scope' } })
    expect((await requireMember(event({}), { can: 'inbox' })).workspaceId).toBe('W1')
  })
})

describe('scoped loaders', () => {
  test('a row of another workspace answers like a row that does not exist', async () => {
    const ctx = await requireMember(event({ 'x-workspace': 'W1' }))
    expect((await scoped.conversation(ctx, 'C1')).id).toBe('C1')
    await expect(scoped.conversation(ctx, 'C2')).rejects.toMatchObject({ statusCode: 404 })
    expect((await scoped.emailTemplate(ctx, 'T1')).id).toBe('T1')
    await expect(scoped.emailTemplate(ctx, 'T2')).rejects.toMatchObject({ statusCode: 404 })
    await expect(scoped.emailTemplate(ctx, 'nope')).rejects.toMatchObject({ statusCode: 404 })
  })

  test('a node is checked through its knowledge model', async () => {
    const ctx = await requireMember(event({ 'x-workspace': 'W1' }))
    expect((await scoped.knowledgeNode(ctx, 'N1')).id).toBe('N1')
    await expect(scoped.knowledgeNode(ctx, 'N2')).rejects.toMatchObject({ statusCode: 404 })
  })
})
