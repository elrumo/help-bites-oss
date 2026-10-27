import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { CLASS_FEATURES, CLASS_GAUGES, DROP_FIELDS, ID_PATHS, IMPORT_ORDER, NOT_PORTABLE, PROJECT_PINNED } from '../shared/transfer'

// Moving data between instances (server/utils/transfer.ts): the rules against
// the schema, and the importer against a fake Parse REST batch endpoint.

process.env.PARSE_URL = 'http://parse.test/parse'
process.env.PARSE_ID = 'app'
process.env.PARSE_MASTER_KEY = 'master'

type Json = Record<string, any>
const ptr = (className: string, objectId: string) => ({ __type: 'Pointer', className, objectId })

const schema = readFileSync(join(import.meta.dir, '../scripts/ensure-schema.mjs'), 'utf8')
const schemaBlock = schema.slice(schema.indexOf('const SCHEMAS = {'), schema.indexOf('\n}\n', schema.indexOf('const SCHEMAS = {')))
const classBody = (name: string) => {
  const start = schemaBlock.indexOf(`\n  ${name}: {\n`)
  const next = schemaBlock.slice(start + 1).search(/\n {2}\w+: \{\n/)
  return schemaBlock.slice(start, next < 0 ? undefined : start + 1 + next)
}
const fieldsOf = (name: string) => [...classBody(name).matchAll(/^ {6}(\w+): \{ type: '(\w+)'(?:, targetClass: '(\w+)')?/gm)].map(m => ({ name: m[1]!, type: m[2]!, target: m[3] }))

// ---- fake Parse ------------------------------------------------------------------

let store = new Map<string, Json>()
let creates: { className: string, id: string, body: Json }[] = []
let headers: Record<string, string>[] = []
let failClass = ''
let counter = 0
let taken: string[] = []
let allowed = { features: true }
const gauges: string[] = []

const fakeParse = {
  Query: class {
    constructor(public className: string) {}
    containedIn() { return this }
    limit() { return this }
    async find() { return this.className === 'Project' ? taken.map(key => ({ get: () => key })) : [] }
  },
  Schema: class {
    constructor(public className: string) {}
    async get() { return { fields: Object.fromEntries(fieldsOf(this.className).map(field => [field.name, {}])) } }
  },
  Object: { extend: (className: string) => ({ createWithoutData: (id: string) => ({ className, id }) }) }
}

Object.assign(globalThis, {
  useParse: () => fakeParse,
  MASTER: {},
  hasFeature: async () => allowed.features,
  checkGauge: async (_ws: unknown, metric: string, add: number) => { gauges.push(`${metric}:${add}`) },
  newPublicKey: () => `pk_${(++counter).toString(16).padStart(24, '0')}`,
  newSecret: () => `sk_new${++counter}`,
  forgetWorkspaceProjects: async () => {},
  enqueueJob: async () => {},
  meiliConfigured: () => false
})

const realFetch = globalThis.fetch
beforeEach(() => {
  store = new Map(); creates = []; headers = []; failClass = ''; counter = 0; taken = []; allowed = { features: true }; gauges.length = 0
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    headers.push(init.headers as Record<string, string>)
    const { requests } = JSON.parse(String(init.body)) as { requests: { method: string, path: string, body?: Json }[] }
    const results = requests.map((request) => {
      const [, , , className = '', id = ''] = request.path.split('/')
      if (request.method === 'POST') {
        if (className === failClass) return { error: { code: 1, error: 'boom' } }
        const objectId = `new${++counter}`
        store.set(`${className}/${objectId}`, request.body!)
        creates.push({ className, id: objectId, body: request.body! })
        return { success: { objectId } }
      }
      if (request.method === 'PUT') store.set(`${className}/${id}`, { ...store.get(`${className}/${id}`), ...request.body })
      if (request.method === 'DELETE') store.delete(`${className}/${id}`)
      return { success: {} }
    })
    return new Response(JSON.stringify(results))
  }) as never
})
afterEach(() => { globalThis.fetch = realFetch; delete process.env.PARSE_MAINTENANCE_KEY })

const { importLines, linesOf } = await import('../server/utils/transfer')
const { WORKSPACE_DATA } = await import('../server/utils/workspaceData')

// ---- the rules against the schema -------------------------------------------------

describe('what travels', () => {
  const exported = Object.keys(WORKSPACE_DATA).filter(name => WORKSPACE_DATA[name]!.scope !== 'none' && WORKSPACE_DATA[name]!.exported !== false)

  test('every exported class either travels or says why not', () => {
    const order = IMPORT_ORDER as readonly string[]
    expect(exported.filter(name => !order.includes(name) && !NOT_PORTABLE[name])).toEqual([])
    expect(order.filter(name => NOT_PORTABLE[name])).toEqual([])
    expect(order.filter(name => !WORKSPACE_DATA[name])).toEqual([])
    expect(new Set(order).size).toBe(order.length)
  })

  test('what a row points at is created before it (a class\'s pointers to itself are fixed up after)', () => {
    const order = IMPORT_ORDER as readonly string[]
    const late = IMPORT_ORDER.flatMap(name => fieldsOf(name).filter(field => field.type === 'Pointer' && field.target && order.includes(field.target) && order.indexOf(field.target) > order.indexOf(name)).map(field => `${name}.${field.name} -> ${field.target}`))
    expect(late).toEqual([])
  })

  test('the id fields, dropped fields, gates and pinned classes are real', () => {
    const real = (className: string, field: string) => fieldsOf(className).some(item => item.name === field)
    for (const [className, paths] of Object.entries(ID_PATHS)) {
      expect(IMPORT_ORDER as readonly string[]).toContain(className)
      for (const [path, target] of Object.entries(paths)) {
        expect(real(className, path.split('.')[0]!)).toBe(true)
        expect(IMPORT_ORDER as readonly string[]).toContain(target)
        // The class an id points at is created first, or is the class itself, unless the field holds
        // a single id (a String column): the importer sets those once everything exists.
        const single = !path.includes('.') && fieldsOf(className).find(item => item.name === path)?.type === 'String'
        if (!single) expect((IMPORT_ORDER as readonly string[]).indexOf(target)).toBeLessThanOrEqual((IMPORT_ORDER as readonly string[]).indexOf(className))
      }
    }
    for (const [className, list] of Object.entries(DROP_FIELDS)) for (const field of list) expect(real(className, field)).toBe(true)
    for (const className of [...Object.keys(CLASS_FEATURES), ...Object.keys(CLASS_GAUGES)]) expect(IMPORT_ORDER as readonly string[]).toContain(className)
    for (const className of PROJECT_PINNED) expect(WORKSPACE_DATA[className]!.scope).toBe('workspace')
    for (const className of PROJECT_PINNED) expect(real(className, 'project')).toBe(true)
  })
})

// ---- the importer -------------------------------------------------------------------

const header = { format: 'helpbites-export', version: 2, scope: 'workspace', workspaceId: 'wsOld', exportedAt: '2026-10-07T00:00:00.000Z' }
const KEY_A = `pk_${'a'.repeat(24)}`
const KEY_B = `pk_${'b'.repeat(24)}`
const old = { workspace: ptr('Workspace', 'wsOld') }
const at = (minute: number) => `2026-01-01T00:0${minute}:00.000Z`

async function* file(...rows: Json[]): AsyncGenerator<string> {
  for (const row of rows) yield typeof row === 'string' ? row : JSON.stringify(row)
}
const line = (className: string, data: Json) => ({ class: className, data })
const workspace = { id: 'wsNew' } as never
const made = (className: string) => creates.filter(item => item.className === className)

function sample(): Json[] {
  return [
    header,
    line('Project', { objectId: 'p1', name: 'Acme', publicKey: KEY_A, secret: 'sk_old', ...old, repoIds: [1], telegram: { chatId: 'x' }, bogusColumn: 1, createdAt: at(0) }),
    line('Project', { objectId: 'p2', name: 'Beta', publicKey: KEY_B, ...old, createdAt: at(1) }),
    line('EndUser', { objectId: 'u1', project: ptr('Project', 'p1'), email: 'a@x.io', createdAt: at(0) }),
    // Someone else's project: nothing in this file, so the row has nowhere to go.
    line('EndUser', { objectId: 'uX', project: ptr('Project', 'theirs'), email: 'b@x.io' }),
    line('KnowledgeModel', { objectId: 'km1', name: 'Docs', ...old, project: ptr('Project', 'p1') }),
    line('KnowledgeNode', { objectId: 'n2', knowledgeModel: ptr('KnowledgeModel', 'km1'), parent: ptr('KnowledgeNode', 'n1'), name: 'Child' }),
    line('KnowledgeNode', { objectId: 'n1', knowledgeModel: ptr('KnowledgeModel', 'km1'), name: 'Root' }),
    line('Conversation', { objectId: 'c1', project: ptr('Project', 'p1'), endUser: ptr('EndUser', 'u1'), assignee: ptr('_User', 'agent1'), subject: 'Hello' }),
    // Out of order on purpose; m2 answers m3, which comes later.
    line('Message', { objectId: 'm2', project: ptr('Project', 'p1'), conversation: ptr('Conversation', 'c1'), body: 'second', replyToId: 'm3', createdAt: at(2) }),
    line('Message', { objectId: 'm3', project: ptr('Project', 'p1'), conversation: ptr('Conversation', 'c1'), body: 'third', createdAt: at(3) }),
    line('Message', { objectId: 'm1', project: ptr('Project', 'p1'), conversation: ptr('Conversation', 'c1'), body: 'first', createdAt: at(1) }),
    line('Message', { objectId: 'mOrphan', conversation: ptr('Conversation', 'gone'), body: 'lost' }),
    line('FeedbackPost', { objectId: 'f1', project: ptr('Project', 'p1'), title: 'Dark mode', pinnedCommentId: 'fc1' }),
    line('FeedbackComment', { objectId: 'fc1', project: ptr('Project', 'p1'), post: ptr('FeedbackPost', 'f1') }),
    line('BoardItem', { objectId: 'b1', project: ptr('Project', 'p1'), feedbackPostIds: ['f1', 'unknown'], conversationIds: ['c1'] }),
    line('EmailTemplate', { objectId: 't1', ...old, project: ptr('Project', 'p1'), name: 'Welcome', lastActorId: 'agent1' }),
    line('Sequence', { objectId: 's1', project: ptr('Project', 'p1'), name: 'Onboarding', status: 'active', steps: [{ id: 'a', template: 't1' }, { id: 'b', template: 'by-key' }] }),
    line('WorkspaceMember', { objectId: 'wm1', ...old, user: ptr('_User', 'agent1'), role: 'owner' }),
    line('AdminApiKey', { objectId: 'k1', ...old, name: 'CI' }),
    line('NotAClass', { objectId: 'x' })
  ]
}

describe('importing', () => {
  test('rows come in as new rows in the caller\'s workspace, with every pointer rewritten', async () => {
    const summary = await importLines(file(...sample()), workspace)
    const [acme, beta] = made('Project')
    expect(acme!.body).toMatchObject({ name: 'Acme', workspace: ptr('Workspace', 'wsNew') })
    expect(acme!.body.secret).toMatch(/^sk_new/)
    expect(acme!.body.repoIds).toBeUndefined()
    expect(acme!.body.telegram).toBeUndefined()
    expect(acme!.body.bogusColumn).toBeUndefined()
    expect(beta!.body.workspace).toEqual(ptr('Workspace', 'wsNew'))

    const [user] = made('EndUser')
    expect(user!.body.project).toEqual(ptr('Project', acme!.id))
    const [convo] = made('Conversation')
    expect(convo!.body).toMatchObject({ project: ptr('Project', acme!.id), endUser: ptr('EndUser', user!.id), subject: 'Hello' })
    // An operator belongs to the old instance.
    expect(convo!.body.assignee).toBeUndefined()
    expect(made('KnowledgeModel')[0]!.body).toMatchObject({ workspace: ptr('Workspace', 'wsNew'), project: ptr('Project', acme!.id) })
    expect(made('EmailTemplate')[0]!.body.lastActorId).toBeUndefined()

    expect(summary.rows).toMatchObject({ Project: 2, EndUser: 1, Conversation: 1, Message: 3, KnowledgeNode: 2, FeedbackPost: 1, FeedbackComment: 1, BoardItem: 1, Sequence: 1 })
    // A key of its own stays; a key another project holds is replaced.
    expect(summary.projects).toEqual([{ name: 'Acme', publicKey: KEY_A, keptKey: true }, { name: 'Beta', publicKey: KEY_B, keptKey: true }])
  })

  test('a public key that is taken is replaced, and said so', async () => {
    taken = [KEY_B]
    const summary = await importLines(file(...sample()), workspace)
    expect(summary.projects[1]).toMatchObject({ name: 'Beta', keptKey: false })
    expect(summary.projects[1]!.publicKey).not.toBe(KEY_B)
    expect(made('Project')[1]!.body.publicKey).toBe(summary.projects[1]!.publicKey)
  })

  test('what does not belong to anything in the file, and what does not travel, is left out and counted', async () => {
    const summary = await importLines(file(...sample()), workspace)
    expect(made('WorkspaceMember')).toEqual([])
    expect(made('AdminApiKey')).toEqual([])
    expect(summary.skipped.WorkspaceMember).toMatchObject({ count: 1 })
    expect(summary.skipped.AdminApiKey).toMatchObject({ count: 1 })
    // A row for someone else's project, and a message with no conversation here.
    expect(summary.skipped.EndUser).toMatchObject({ count: 1 })
    expect(summary.skipped.Message).toMatchObject({ count: 1 })
    expect(summary.skipped.NotAClass).toBeUndefined()
  })

  test('ids kept as text and pointers to later rows are fixed up once everything exists', async () => {
    await importLines(file(...sample()), workspace)
    const ids = (className: string, name: string, key = 'name') => creates.find(item => item.className === className && item.body[key] === name)!.id
    const store2 = (className: string, id: string) => store.get(`${className}/${id}`)!
    // A child listed before its parent.
    expect(store2('KnowledgeNode', ids('KnowledgeNode', 'Child')).parent).toEqual(ptr('KnowledgeNode', ids('KnowledgeNode', 'Root')))
    // A reply to a message that comes later in the file.
    expect(store2('Message', ids('Message', 'second', 'body')).replyToId).toBe(ids('Message', 'third', 'body'))
    // A post's pinned comment: the comments come after the posts.
    expect(store2('FeedbackPost', made('FeedbackPost')[0]!.id).pinnedCommentId).toBe(made('FeedbackComment')[0]!.id)
    // Lists of ids: known ones are replaced, unknown ones stay.
    expect(made('BoardItem')[0]!.body).toMatchObject({ feedbackPostIds: [made('FeedbackPost')[0]!.id, 'unknown'], conversationIds: [made('Conversation')[0]!.id] })
    // A sequence's template, by id or (when not an id here) as it was; a live sequence does not start by itself.
    const sequence = made('Sequence')[0]!.body
    expect(sequence.steps).toEqual([{ id: 'a', template: made('EmailTemplate')[0]!.id }, { id: 'b', template: 'by-key' }])
    expect(sequence.status).toBe('paused')
  })

  test('a lead form keeps its leads, its segment, its sequence and its welcome email', async () => {
    const [head, project] = sample()
    await importLines(file(head!, project!,
      line('LeadForm', { objectId: 'lf1', project: ptr('Project', 'p1'), key: 'waitlist', name: 'Waitlist', segment: 'seg1', sequence: 's1', welcomeTemplate: 't1', confirmTemplate: 'confirm-by-key' }),
      line('EndUser', { objectId: 'u1', project: ptr('Project', 'p1'), email: 'a@x.io', leadForms: ['lf1'], origin: { type: 'lead_form', id: 'lf1' } }),
      line('ContactSegment', { objectId: 'seg1', project: ptr('Project', 'p1'), name: 'Leads · Waitlist', auto: 'lead_form', filter: { match: 'all', rules: [{ field: 'leadForms', op: 'includes', value: 'lf1' }] } }),
      line('EmailTemplate', { objectId: 't1', ...old, project: ptr('Project', 'p1'), name: 'Welcome' }),
      line('Sequence', { objectId: 's1', project: ptr('Project', 'p1'), name: 'Nurture', status: 'draft', steps: [] })
    ), workspace)
    const form = made('LeadForm')[0]!
    expect(made('EndUser')[0]!.body).toMatchObject({ leadForms: [form.id], origin: { type: 'lead_form', id: form.id } })
    expect(made('ContactSegment')[0]!.body.filter.rules[0].value).toBe(form.id)
    // The form comes first; what it names is set once everything exists.
    expect(store.get(`LeadForm/${form.id}`)).toMatchObject({ segment: made('ContactSegment')[0]!.id, sequence: made('Sequence')[0]!.id, welcomeTemplate: made('EmailTemplate')[0]!.id, confirmTemplate: 'confirm-by-key' })
  })

  test('without the maintenance key rows are created oldest first; with it they keep their dates', async () => {
    await importLines(file(...sample()), workspace)
    expect(made('Message').map(item => item.body.body)).toEqual(['first', 'second', 'third'])
    expect(made('Message')[0]!.body.createdAt).toBeUndefined()
    expect(headers.every(item => !('X-Parse-Maintenance-Key' in item))).toBe(true)

    creates = []; store = new Map(); headers = []
    process.env.PARSE_MAINTENANCE_KEY = 'maintenance'
    await importLines(file(...sample()), workspace)
    expect(made('Message')[0]!.body.createdAt).toEqual({ __type: 'Date', iso: at(2) })
    expect(made('Message')[0]!.body.updatedAt).toEqual({ __type: 'Date', iso: at(2) })
    expect(headers.every(item => item['X-Parse-Maintenance-Key'] === 'maintenance')).toBe(true)
  })

  test('a file cannot say where a row lives or add columns', async () => {
    await importLines(file(header,
      line('Project', { objectId: 'p1', name: 'A', workspace: ptr('Workspace', 'someoneElse'), publicKey: KEY_A, ACL: { '*': { read: true } }, evil: 'x', objectId2: 'y' }),
      line('KnowledgeModel', { objectId: 'km1', name: 'M', workspace: ptr('Workspace', 'someoneElse'), project: ptr('Project', 'theirs') })
    ), workspace)
    expect(made('Project')[0]!.body.workspace).toEqual(ptr('Workspace', 'wsNew'))
    expect(made('Project')[0]!.body.ACL).toBeUndefined()
    expect(made('Project')[0]!.body.evil).toBeUndefined()
    // A project that is not in the file is not reached: the model is the workspace's own.
    expect(made('KnowledgeModel')[0]!.body.workspace).toEqual(ptr('Workspace', 'wsNew'))
    expect(made('KnowledgeModel')[0]!.body.project).toBeUndefined()
  })

  test('a plan that lacks a feature leaves that class out; limits are checked per class before it is created', async () => {
    allowed.features = false
    const summary = await importLines(file(...sample()), workspace)
    expect(made('Sequence')).toEqual([])
    expect(summary.skipped.Sequence!.reason).toContain('plan')
    expect(gauges).toEqual(expect.arrayContaining(['projects:2', 'contacts:1', 'knowledgeModels:1']))
  })

  test('if anything fails, nothing it created is left', async () => {
    failClass = 'Message'
    await expect(importLines(file(...sample()), workspace)).rejects.toThrow('boom')
    expect(creates.length).toBeGreaterThan(5)
    expect([...store.keys()]).toEqual([])
  })

  test('only a HelpBites export is read', async () => {
    await expect(importLines(file({ hello: 'world' }), workspace)).rejects.toMatchObject({ statusCode: 400 })
    await expect(importLines(file('not json'), workspace)).rejects.toMatchObject({ statusCode: 400 })
    await expect(importLines(file(), workspace)).rejects.toMatchObject({ statusCode: 400 })
    await expect(importLines(file({ ...header, version: 99 }), workspace)).rejects.toMatchObject({ statusCode: 400 })
    // The first version of the format is still read.
    await expect(importLines(file({ format: 'helpbites-export', version: 1, workspaceId: 'w', exportedAt: 'x' }), workspace)).resolves.toMatchObject({ rows: {} })
  })
})

describe('reading a file', () => {
  test('lines come out of a gzip stream, whatever the chunking', async () => {
    const text = `${JSON.stringify({ a: 'é' })}\n${JSON.stringify({ b: 2 })}\n`
    const zipped = gzipSync(Buffer.from(text))
    const chunks = Readable.from([zipped.subarray(0, 7), zipped.subarray(7, 20), zipped.subarray(20)])
    const lines: string[] = []
    for await (const item of linesOf(chunks)) lines.push(item)
    expect(lines).toEqual([JSON.stringify({ a: 'é' }), JSON.stringify({ b: 2 })])
  })

  test('a file that is one endless line is refused, not buffered', async () => {
    // 20 MB of one character compresses to a few KB; reading it into memory as a line is what the cap stops.
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 97))
    await expect((async () => { for await (const _line of linesOf(Readable.from([bomb]))) { /* drained */ } })()).rejects.toMatchObject({ statusCode: 400 })
  })
})
