import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pointerId } from '../server/utils/parse'
import { sealSecret } from '../server/utils/secrets'

// What a workspace owns (server/utils/workspaceData.ts): the map against the
// schema, the export's lines, and deleting it all against an in-memory Parse.

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'

type Fields = Record<string, unknown>
const db = new Map<string, Map<string, Fields>>()
const table = (className: string) => db.get(className) || db.set(className, new Map()).get(className)!
let down = false
let downAfter = Infinity
let ghostIn = ''

const ptr = (className: string, id: string) => ({ className, id })
const same = (stored: unknown, wanted: unknown) => wanted && typeof wanted === 'object' ? pointerId(stored) === pointerId(wanted) : stored === wanted

class Row {
  constructor(public className: string, public id: string, public fields: Fields) {}
  get(key: string) { return this.fields[key] }
  set(key: string, value: unknown) { this.fields[key] = value }
  unset(key: string) { delete this.fields[key] }
  async save() { if (down) throw new Error('Parse is down') }
  async destroy() {
    if (down) throw new Error('Parse is down')
    if (!table(this.className).delete(this.id)) throw Object.assign(new Error('Object not found'), { code: 101 })
  }

  toJSON() { return { objectId: this.id, ...this.fields } }
}

class Query {
  className: string
  tests: ((fields: Fields, id: string) => boolean)[] = []
  max = 100
  constructor(className: string) { this.className = className }
  equalTo(key: string, value: unknown) { this.tests.push((f, id) => key === 'objectId' ? id === value : same(f[key], value)); return this }
  containedIn(key: string, values: unknown[]) { this.tests.push(f => values.some(v => same(f[key], v))); return this }
  doesNotExist(key: string) { this.tests.push(f => f[key] === undefined); return this }
  greaterThan(key: string, value: string) { this.tests.push((_f, id) => key === 'objectId' && id > value); return this }
  select() { return this }
  ascending() { return this }
  limit(n: number) { this.max = n; return this }
  async find() {
    if (down) throw new Error('Parse is down')
    const rows = [...table(this.className)].filter(([id, f]) => this.tests.every(t => t(f, id))).sort(([a], [b]) => a.localeCompare(b)).slice(0, this.max).map(([id, f]) => new Row(this.className, id, f))
    // Another run deleted one of these between the read and the delete.
    if (ghostIn === this.className && rows.length) {
      ghostIn = ''
      rows.push(new Row(this.className, `${rows.at(-1)!.id}~ghost`, {}))
    }
    return rows
  }

  async get(id: string) {
    const fields = table(this.className).get(id)
    if (!fields) throw Object.assign(new Error('Object not found'), { code: 101 })
    return new Row(this.className, id, fields)
  }
}

let destroyCalls = 0
const fakeParse = {
  Query,
  User: '_User',
  Error: { OBJECT_NOT_FOUND: 101 },
  Object: {
    extend: (className: string) => ({ createWithoutData: (id: string) => ptr(className, id) }),
    async destroyAll(rows: Row[]) {
      if (++destroyCalls > downAfter) down = true
      if (down) throw new Error('Parse is down')
      if (rows.some(row => !table(row.className).has(row.id))) throw Object.assign(new Error('Some were not found'), { code: 600 })
      for (const row of rows) table(row.className).delete(row.id)
    },
    async saveAll() { if (down) throw new Error('Parse is down') }
  }
}

const redisKeys = new Set<string>()
const removedPrefixes: string[] = []
const meiliFilters: string[] = []
const invalidated: string[] = []
const forgotten: string[] = []
const audits: { action: string, data?: Fields }[] = []

const g = globalThis as Record<string, unknown>
Object.assign(g, {
  useParse: () => fakeParse,
  MASTER: {},
  pointerId,
  invalidate: async (kind: string, key: string) => { invalidated.push(`${kind}:${key}`) },
  forgetProject: (key: string) => { forgotten.push(key) },
  forgetWorkspaceProjects: async () => {},
  audit: async (entry: { action: string, data?: Fields }) => { audits.push(entry) },
  s3Configured: () => true,
  removeObjectsUnder: async (prefix: string) => { removedPrefixes.push(prefix); return 0 },
  meiliConfigured: () => true,
  deleteByFilter: async (index: string, filter: string) => { meiliFilters.push(`${index} ${filter}`) },
  CONVERSATIONS_INDEX: 'conversations',
  ENDUSERS_INDEX: 'endusers',
  KNOWLEDGE_INDEX: 'knowledge',
  useRedis: () => ({
    scan: async (_cursor: string, _match: string, pattern: string) => ['0', [...redisKeys].filter(key => key.startsWith(pattern.slice(0, -1)))],
    del: async (...keys: string[]) => { for (const key of keys) redisKeys.delete(key) }
  })
})

const secrets = await import('../server/utils/secrets')
Object.assign(globalThis, { signLinkToken: secrets.signLinkToken, readLinkToken: secrets.readLinkToken })
process.env.HELPBITES_SECRET ||= 'x'.repeat(40)
const data = await import('../server/utils/workspaceData')
const { WORKSPACE_DATA, confirmsDeletion, exportHeader, exportKey, exportLine, purgeOrder, purgeWorkspace, workspaceRows } = data

// ---- the map against the schema --------------------------------------------------

const schema = readFileSync(join(import.meta.dir, '../scripts/ensure-schema.mjs'), 'utf8')
const schemaBlock = schema.slice(schema.indexOf('const SCHEMAS = {'), schema.indexOf('\n}\n', schema.indexOf('const SCHEMAS = {')))
const schemaClasses = [...schemaBlock.matchAll(/^ {2}(\w+): \{$/gm)].map(m => m[1]!)
const classBody = (name: string) => {
  const start = schemaBlock.indexOf(`\n  ${name}: {\n`)
  const next = schemaBlock.slice(start + 1).search(/\n {2}\w+: \{\n/)
  return schemaBlock.slice(start, next < 0 ? undefined : start + 1 + next)
}
const hasPointer = (name: string, field: string, target: string) => classBody(name).includes(`${field}: { type: 'Pointer', targetClass: '${target}' }`)

describe('what a workspace owns', () => {
  test('every class in scripts/ensure-schema.mjs says how it belongs to a workspace', () => {
    expect(schemaClasses.length).toBeGreaterThan(40)
    expect(schemaClasses.filter(name => !WORKSPACE_DATA[name])).toEqual([])
    expect(['_User', '_Session'].filter(name => !WORKSPACE_DATA[name])).toEqual([])
    // And nothing in the map that the schema has never heard of.
    expect(Object.keys(WORKSPACE_DATA).filter(name => !schemaClasses.includes(name) && !name.startsWith('_'))).toEqual([])
  })

  test('the pointer each rule follows is on the class', () => {
    const wrong = Object.entries(WORKSPACE_DATA).flatMap(([name, rule]) => [
      rule.scope === 'workspace' && !hasPointer(name, 'workspace', 'Workspace') ? `${name}.workspace` : '',
      rule.scope === 'project' && !hasPointer(name, 'project', 'Project') ? `${name}.project` : '',
      rule.orWorkspace && !hasPointer(name, 'workspace', 'Workspace') ? `${name}.workspace` : '',
      rule.parent && !hasPointer(name, rule.parent.field, rule.parent.className) ? `${name}.${rule.parent.field}` : '',
      rule.scope === 'parent' && !rule.parent ? `${name}: no parent` : ''
    ]).filter(Boolean)
    expect(wrong).toEqual([])
  })

  test('parents are found directly, and are deleted after what hangs off them; projects go last', () => {
    const order = purgeOrder()
    for (const [name, rule] of Object.entries(WORKSPACE_DATA)) {
      if (rule.scope === 'none') expect(order).not.toContain(name)
      else expect(order).toContain(name)
      if (!rule.parent) continue
      expect(['workspace', 'project']).toContain(WORKSPACE_DATA[rule.parent.className]!.scope)
      expect(order.indexOf(name)).toBeLessThan(order.indexOf(rule.parent.className))
    }
    expect(order.at(-1)).toBe('Project')
    expect(new Set(order).size).toBe(order.length)
  })
})

// ---- the export's lines ---------------------------------------------------------

describe('export lines', () => {
  test('the first line names the format', () => {
    expect(exportHeader('ws1', new Date('2026-10-07T12:00:00Z'))).toEqual({ format: 'helpbites-export', version: 2, scope: 'workspace', workspaceId: 'ws1', exportedAt: '2026-10-07T12:00:00.000Z' })
    expect(exportHeader('ws1', new Date('2026-10-07T12:00:00Z'), 'p1')).toMatchObject({ scope: 'project', projectId: 'p1' })
    expect(exportKey('ws1', new Date('2026-10-07T12:00:00Z'))).toMatch(/^exports\/ws1\/2026-10-07T12-00-00-000Z-[0-9a-f]{16}\.jsonl\.gz$/)
  })

  test('a row keeps its data and loses its credentials', () => {
    const project = {
      objectId: 'p1', name: 'Acme', publicKey: 'pk_1', secret: 'sk_live', actionWebhookUrl: 'https://x.io/a', actionWebhookSecret: 'whsec_a', eventWebhookSecret: 'whsec_e',
      errors: { dsn: 'https://k@glitch/1', webhookToken: 'tok', more: [{ dsn: 'https://k@bs/2', webhookToken: 'tok2', label: 'api' }] }, errorTrackers: { glitchtip: { url: 'https://glitch', token: 'gt' }, bugsink: { url: 'https://bs', token: 'bt' } },
      workspace: { __type: 'Pointer', className: 'Workspace', objectId: 'ws1' }
    }
    const line = exportLine('Project', project)
    expect(line).toEqual({ class: 'Project', data: { objectId: 'p1', name: 'Acme', publicKey: 'pk_1', actionWebhookUrl: 'https://x.io/a', errors: { dsn: 'https://k@glitch/1', more: [{ dsn: 'https://k@bs/2', label: 'api' }] }, errorTrackers: { glitchtip: { url: 'https://glitch' }, bugsink: { url: 'https://bs' } }, workspace: { __type: 'Pointer', className: 'Workspace', objectId: 'ws1' } } })
    // Pure: the row's own JSON is untouched.
    expect(project.secret).toBe('sk_live')
    expect(project.errorTrackers.glitchtip.token).toBe('gt')
  })

  test('hashes, sealed values and account secrets never leave', () => {
    expect(exportLine('AdminApiKey', { objectId: 'k1', name: 'CI', prefix: 'ak_12', hash: 'abc' }).data).toEqual({ objectId: 'k1', name: 'CI', prefix: 'ak_12' })
    expect(exportLine('WorkspaceInvite', { email: 'a@x.io', tokenHash: 'abc' }).data).toEqual({ email: 'a@x.io' })
    expect(exportLine('ContactSource', { name: 'Users', secretSealed: sealSecret('postgres://u:p@db/x'), config: { table: 'users' } }).data).toEqual({ name: 'Users', config: { table: 'users' } })
    expect(exportLine('SupportAgent', { name: 'Bot', apiKey: 'sk-plain' }).data).toEqual({ name: 'Bot' })
    expect(exportLine('EmailTemplate', { name: 'Welcome', shareToken: 'share' }).data).toEqual({ name: 'Welcome' })
    // A sealed value anywhere, under any name, is a credential.
    expect(exportLine('EmailLog', { metadata: { key: sealSecret('x'), plain: 'y' }, tags: ['a', sealSecret('z')] }).data).toEqual({ metadata: { plain: 'y' }, tags: ['a'] })
    expect(exportLine('ChangelogRelease', { version: 'v1.2.3.4' }).data).toEqual({ version: 'v1.2.3.4' })
    expect(exportLine('Conversation', { _hashed_password: 'x', sessionToken: 'r:1', subject: 'Hi' }).data).toEqual({ subject: 'Hi' })
  })

  test('a line is plain JSON', () => {
    const line = exportLine('Message', { objectId: 'm1', body: 'Hi', createdAt: '2026-10-07T12:00:00.000Z', attachments: [] })
    expect(JSON.parse(JSON.stringify(line))).toEqual(line)
  })
})

// ---- deleting -------------------------------------------------------------------

function put(className: string, id: string, fields: Fields = {}) {
  table(className).set(id, fields)
}

function seed() {
  db.clear()
  redisKeys.clear()
  for (const list of [removedPrefixes, meiliFilters, invalidated, forgotten, audits]) list.length = 0
  down = false
  downAfter = Infinity
  destroyCalls = 0
  ghostIn = ''
  const A = ptr('Workspace', 'A')
  const B = ptr('Workspace', 'B')
  put('Workspace', 'A', { name: 'Acme', status: 'deleting', owner: ptr('_User', 'u1'), ai: { model: 'x' }, settings: { a: 1 }, lastExport: { key: 'exports/A/x' } })
  put('Workspace', 'B', { name: 'Beta', status: 'active' })
  put('_User', 'u1', { defaultWorkspace: A })
  put('_User', 'u2', { defaultWorkspace: B })
  put('_User', 'u3', { defaultWorkspace: A })
  put('_Session', 's1', { user: ptr('_User', 'u1') })
  put('Device', 'd1', { agent: ptr('_User', 'u1') })
  put('WorkspaceMember', 'wm1', { workspace: A, user: ptr('_User', 'u1'), role: 'owner' })
  put('WorkspaceMember', 'wm2', { workspace: B, user: ptr('_User', 'u2'), role: 'owner' })
  put('WorkspaceMember', 'wm3', { workspace: A, user: ptr('_User', 'u3'), role: 'agent' })
  put('WorkspaceInvite', 'wi1', { workspace: A, email: 'x@y.io' })
  put('AdminApiKey', 'ak1', { workspace: A, hash: 'h' })
  put('WorkspaceUsage', 'wu1', { workspace: A, metric: 'emails' })
  put('WorkspaceUsage', 'wu2', { workspace: B, metric: 'emails' })
  put('Job', 'j1', { workspace: A, kind: 'workspace.purge' })
  put('Job', 'j2', { workspace: A, kind: 'ai.autoReply' })
  put('Job', 'j3', { workspace: B, kind: 'ai.autoReply' })
  put('AuditLog', 'al1', { workspace: A, action: 'workspace.delete' })
  put('Project', 'pA1', { workspace: A, publicKey: 'pk_a1' })
  put('Project', 'pA2', { workspace: A, publicKey: 'pk_a2' })
  put('Project', 'pB1', { workspace: B, publicKey: 'pk_b1' })
  put('Conversation', 'cA', { project: ptr('Project', 'pA1') })
  put('Conversation', 'cB', { project: ptr('Project', 'pB1') })
  // More than a page of them, and a few from before messages carried their project.
  for (let i = 0; i < 1200; i++) put('Message', `mA${String(i).padStart(4, '0')}`, { project: ptr('Project', 'pA1'), conversation: ptr('Conversation', 'cA') })
  for (let i = 0; i < 3; i++) put('Message', `mL${i}`, { conversation: ptr('Conversation', 'cA') })
  put('Message', 'mB', { project: ptr('Project', 'pB1'), conversation: ptr('Conversation', 'cB') })
  put('Message', 'mBL', { conversation: ptr('Conversation', 'cB') })
  put('EndUser', 'eA', { project: ptr('Project', 'pA2') })
  put('EndUser', 'eB', { project: ptr('Project', 'pB1') })
  put('KnowledgeModel', 'kA', { workspace: A, project: ptr('Project', 'pA1') })
  put('KnowledgeModel', 'kB', { workspace: B })
  put('KnowledgeNode', 'nA', { knowledgeModel: ptr('KnowledgeModel', 'kA') })
  put('Faq', 'fA1', { knowledgeModel: ptr('KnowledgeModel', 'kA') })
  put('Faq', 'fA2', { knowledgeModel: ptr('KnowledgeModel', 'kA') })
  put('Faq', 'fB', { knowledgeModel: ptr('KnowledgeModel', 'kB') })
  put('SupportAgent', 'sA', { workspace: A })
  put('AgentKnowledgeAssignment', 'aA', { supportAgent: ptr('SupportAgent', 'sA') })
  put('EmailTemplate', 'tA', { workspace: A })
  put('EmailTemplate', 'tA2', { workspace: A, project: ptr('Project', 'pA1') })
  put('EmailTemplate', 'tB', { workspace: B })
  put('EmailChatMessage', 'ecA', { template: ptr('EmailTemplate', 'tA') })
  put('EmailChatMessage', 'ecB', { template: ptr('EmailTemplate', 'tB') })
  put('EmailLog', 'elA', { project: ptr('Project', 'pA1') })
  put('EmailLog', 'elAw', { workspace: A })
  put('EmailLog', 'elSys', { source: 'system' })
  put('EmailLog', 'elB', { project: ptr('Project', 'pB1') })
  for (const key of ['sb:usage:A:2026-10:emails', 'sb:usage:A:all:storageBytes', 'sb:usage:B:2026-10:emails', 'sb:usage:AB:2026-10:emails']) redisKeys.add(key)
}

const ids = (className: string) => [...table(className).keys()].sort()

function expectPurged() {
  const A = table('Workspace').get('A')!
  expect(A).toMatchObject({ name: 'Acme', status: 'deleted', owner: ptr('_User', 'u1') })
  expect(A.deletedAt).toBeInstanceOf(Date)
  expect(A.ai).toBeUndefined()
  expect(A.settings).toBeUndefined()
  expect(A.lastExport).toBeUndefined()
  expect(table('Workspace').get('B')!.status).toBe('active')

  expect(ids('Project')).toEqual(['pB1'])
  expect(ids('Conversation')).toEqual(['cB'])
  expect(ids('Message')).toEqual(['mB', 'mBL'])
  expect(ids('EndUser')).toEqual(['eB'])
  expect(ids('KnowledgeModel')).toEqual(['kB'])
  expect(ids('KnowledgeNode')).toEqual([])
  expect(ids('Faq')).toEqual(['fB'])
  expect(ids('SupportAgent')).toEqual([])
  expect(ids('AgentKnowledgeAssignment')).toEqual([])
  expect(ids('EmailTemplate')).toEqual(['tB'])
  expect(ids('EmailChatMessage')).toEqual(['ecB'])
  expect(ids('EmailLog')).toEqual(['elB', 'elSys'])
  expect(ids('WorkspaceMember')).toEqual(['wm2'])
  expect(ids('WorkspaceInvite')).toEqual([])
  expect(ids('AdminApiKey')).toEqual([])
  expect(ids('WorkspaceUsage')).toEqual(['wu2'])
  // The running purge's own row stays for the runner to finish.
  expect(ids('Job')).toEqual(['j1', 'j3'])
  // Accounts, sessions, devices and the record of what happened stay.
  expect(ids('_User')).toEqual(['u1', 'u2', 'u3'])
  expect(ids('_Session')).toEqual(['s1'])
  expect(ids('Device')).toEqual(['d1'])
  expect(ids('AuditLog')).toEqual(['al1'])
  expect(table('_User').get('u1')!.defaultWorkspace).toBeUndefined()
  expect(table('_User').get('u3')!.defaultWorkspace).toBeUndefined()
  expect(table('_User').get('u2')!.defaultWorkspace).toEqual(ptr('Workspace', 'B'))

  expect([...redisKeys].sort()).toEqual(['sb:usage:AB:2026-10:emails', 'sb:usage:B:2026-10:emails'])
  expect(new Set(removedPrefixes)).toEqual(new Set(['pA1/', 'pA2/', 'knowledge/kA/', 'emails/tA/', 'exports/A/']))
  expect(new Set(meiliFilters)).toEqual(new Set(['conversations workspaceId = "A"', 'endusers workspaceId = "A"', 'knowledge workspaceId = "A"']))
  expect(invalidated).toContain('members:u1')
  expect(invalidated).toContain('members:u3')
  expect(invalidated).toContain('workspace:A')
  expect(forgotten).toEqual(expect.arrayContaining(['pk_a1', 'pk_a2']))
  expect(audits.at(-1)?.action).toBe('workspace.purged')
}

describe('deleting a workspace', () => {
  beforeEach(seed)

  test('everything it owns goes, and nothing of anyone else\'s', async () => {
    await purgeWorkspace('A')
    expectPurged()
  })

  test('running it again changes nothing and does not fail', async () => {
    await purgeWorkspace('A')
    const deletedAt = table('Workspace').get('A')!.deletedAt
    await purgeWorkspace('A')
    expectPurged()
    expect(table('Workspace').get('A')!.deletedAt).toBe(deletedAt)
  })

  test('a run that dies halfway is finished by the next one', async () => {
    downAfter = 3
    await expect(purgeWorkspace('A')).rejects.toThrow('Parse is down')
    expect(table('Workspace').get('A')!.status).toBe('deleting')
    down = false
    downAfter = Infinity
    await purgeWorkspace('A')
    expectPurged()
  })

  test('rows another run already deleted are skipped, not fatal', async () => {
    ghostIn = 'Message'
    await purgeWorkspace('A')
    expectPurged()
  })

  test('a workspace nobody deleted is never emptied', async () => {
    await purgeWorkspace('B')
    await purgeWorkspace('missing')
    await purgeWorkspace('../A')
    expect(ids('Project')).toEqual(['pA1', 'pA2', 'pB1'])
    expect(ids('Message')).toHaveLength(1205)
    expect(removedPrefixes).toEqual([])
  })

  test('the deletion must be confirmed with the exact name', () => {
    const workspace = { get: (key: string) => (key === 'name' ? 'Acme' : undefined) } as any
    expect(confirmsDeletion(workspace, 'Acme')).toBe(true)
    expect(confirmsDeletion(workspace, 'acme')).toBe(false)
    expect(confirmsDeletion(workspace, ' Acme')).toBe(false)
    expect(confirmsDeletion(workspace, undefined)).toBe(false)
    expect(confirmsDeletion({ get: () => undefined } as any, 'Workspace')).toBe(true)
  })
})

describe('reading a workspace', () => {
  beforeEach(seed)

  test('in batches of at most 500, each row once, only its own, without the job queue', async () => {
    const seen = new Map<string, string[]>()
    for await (const { className, rows } of workspaceRows('A')) {
      expect(rows.length).toBeLessThanOrEqual(500)
      seen.set(className, [...(seen.get(className) || []), ...rows.map(row => row.id)])
    }
    const messages = seen.get('Message')!
    expect(messages).toHaveLength(1203)
    expect(new Set(messages).size).toBe(1203)
    expect(messages).not.toContain('mB')
    expect(messages).not.toContain('mBL')
    expect(seen.get('EmailLog')!.sort()).toEqual(['elA', 'elAw'])
    expect(seen.get('Faq')!.sort()).toEqual(['fA1', 'fA2'])
    expect(seen.get('Project')!.sort()).toEqual(['pA1', 'pA2'])
    expect(seen.has('Job')).toBe(false)
    expect(seen.has('AuditLog')).toBe(false)
    expect(seen.has('_User')).toBe(false)
    expect(seen.has('Workspace')).toBe(false)
  })
})

describe('the demo', () => {
  test('refuses exporting and deleting, like anything else it does not fake', async () => {
    const { demoApi } = await import('../app/utils/demoApi')
    await expect(demoApi('/admin/workspace/export', { method: 'POST' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(demoApi('/admin/workspace/export')).rejects.toMatchObject({ statusCode: 403 })
    await expect(demoApi('/admin/workspace', { method: 'DELETE', body: { confirm: 'Acme Inc.' } })).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('export download links', () => {
  const key = 'exports/ws1/2026-10-07T12-00-00-000Z-0123456789abcdef.jsonl.gz'
  const tokenOf = (url: string) => url.split('/v1/exports/')[1]!

  test('open the one export they were made for, until they expire', () => {
    const now = Date.now()
    const url = data.exportDownloadUrl(key, 3600, now)
    expect(data.readExportDownload(tokenOf(url), now + 1000)).toBe(key)
    expect(data.readExportDownload(tokenOf(url), now + 3601 * 1000)).toBeNull()
  })

  test('a forged or altered link opens nothing, nor a link to anything but an export', () => {
    const url = data.exportDownloadUrl(key, 3600)
    expect(data.readExportDownload(`${tokenOf(url)}x`)).toBeNull()
    expect(data.readExportDownload('not-a-token')).toBeNull()
    expect(data.readExportDownload(tokenOf(data.exportDownloadUrl('knowledge/m1/doc.md', 3600)))).toBeNull()
    expect(data.readExportDownload(tokenOf(data.exportDownloadUrl('exports/../secret.jsonl.gz', 3600)))).toBeNull()
  })
})

describe('exporting one project', () => {
  beforeEach(seed)

  test('is that project and what hangs off it or is pinned to it, nothing else of the workspace', async () => {
    const seen: Record<string, string[]> = {}
    const classes = ['Project', 'EndUser', 'Conversation', 'Message', 'KnowledgeModel', 'KnowledgeNode', 'Faq', 'SupportAgent', 'EmailTemplate', 'EmailLog', 'WorkspaceMember']
    for await (const { className, rows } of workspaceRows('A', classes, 'pA1')) seen[className] = [...(seen[className] || []), ...rows.map(row => row.id)]
    expect(seen.Project).toEqual(['pA1'])
    expect(seen.Conversation).toEqual(['cA'])
    // Including the messages from before they carried their project.
    expect(seen.Message).toHaveLength(1203)
    expect(seen.KnowledgeModel).toEqual(['kA'])
    expect(seen.KnowledgeNode).toEqual(['nA'])
    expect(seen.Faq).toEqual(['fA1', 'fA2'])
    expect(seen.EmailTemplate).toEqual(['tA2'])
    expect(seen.EmailLog).toEqual(['elA'])
    // Another project's contacts, the workspace's assistants, its people.
    expect(seen.EndUser).toBeUndefined()
    expect(seen.SupportAgent).toBeUndefined()
    expect(seen.WorkspaceMember).toBeUndefined()
  })
})
