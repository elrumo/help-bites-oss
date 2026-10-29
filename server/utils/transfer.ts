import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { createError } from 'h3'
import { ATTACHMENT_MIME_TYPES } from '#shared/support'
import { ITEM_FILE_TYPES } from '#shared/itemAttachments'
import { CREDENTIAL_CLASSES, CLASS_FEATURES, CLASS_GAUGES, DROP_FIELDS, EXPORT_FORMAT, EXPORT_VERSIONS, FILE_CLASS, FILE_KEY_FIELDS, FILE_MAX_BYTES, ID_PATHS, IMPORT_ORDER, NOT_PORTABLE, SEALED_KEY, WORKSPACE_SETTINGS_CLASS, readTransferFiles, rewriteFileUrls, type TransferFiles, type TransferOptions, type TransferScope, type TransferSummary } from '#shared/transfer'
import { WORKSPACE_DATA, pagedRows } from './workspaceData'

// Moving a workspace or a project between instances. The source writes the
// portable export (workspaceData.ts portableExport); this reads it, from an
// uploaded file or straight from the other instance's API, and creates the
// rows in the caller's workspace as a background job (`workspace.transfer`).
//
// Parse hands out its own ids, so every row gets a new one and every pointer,
// and the few ids kept as text (shared/transfer.ts ID_PATHS), is rewritten
// through a map of old to new. A row whose target comes later (a post's pinned
// comment) or is itself (a reply's parent) is fixed up at the end. A pointer to
// anything the file does not hold (an operator, another workspace's project) is
// dropped, so a hostile file can only ever create rows in the caller's own
// workspace. If anything fails, every row created so far is deleted again.
//
// Files: an export made with `files: binary` carries the bucket's files as `_File`
// lines ahead of the rows that use them. They are stored under
// `imports/<workspace>/<run>/<old key>` (never a key the file chose outside it),
// and every link or key in the rows that named one is pointed at the new copy. An
// export of links leaves the links as they were, so the old bucket has to stay up;
// a key with no link (a lead form's upload) is cleared, and the summary says so.
// Credentials arrive as `{ $sealed: plain }` and are sealed again with this
// instance's key.
//
// Rows are written over Parse's REST batch endpoint rather than the SDK because
// only REST can carry the original `createdAt` (it needs Parse's maintenance
// key, PARSE_MAINTENANCE_KEY). Without it rows get the time of the import, and
// are created oldest first so the order of a conversation survives.

const BATCH = 20
/** Rows of one class held at once when they have to be sorted (no maintenance key). */
const SORT_LIMIT = 250_000
/** How long a pull may run: a large inbox over a slow link. */
const PULL_MS = 6 * 3600 * 1000
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3

type Json = Record<string, any>
type Pointer = { __type: 'Pointer', className: string, objectId: string }
type Fixup = { className: string, id: string, field: string, kind: 'pointer' | 'id', target: string, old: string }
type Prepared = { old: string, body: Json, pending: Omit<Fixup, 'className' | 'id'>[], createdAt: string }
type Request = { method: 'POST' | 'PUT' | 'DELETE', path: string, body?: Json }

const isPointer = (value: unknown): value is Pointer => !!value && typeof value === 'object' && (value as Json).__type === 'Pointer' && typeof (value as Json).objectId === 'string'
const pointerTo = (className: string, objectId: string): Pointer => ({ __type: 'Pointer', className, objectId })
const isoOf = (value: unknown) => String((value as Json)?.iso ?? value ?? '')

// ---- Parse over REST -------------------------------------------------------------

async function parseBatch(requests: Request[], maintenance = false): Promise<string[]> {
  const base = new URL(String(process.env.PARSE_URL))
  const prefix = base.pathname.replace(/\/+$/, '')
  const response = await fetch(`${base.origin}${prefix}/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Parse-Application-Id': String(process.env.PARSE_ID),
      'X-Parse-Master-Key': String(process.env.PARSE_MASTER_KEY),
      ...(maintenance ? { 'X-Parse-Maintenance-Key': String(process.env.PARSE_MAINTENANCE_KEY) } : {})
    },
    body: JSON.stringify({ requests: requests.map(({ method, path, body }) => ({ method, path: `${prefix}${path}`, body })) })
  })
  if (!response.ok) throw new Error(`Parse answered ${response.status}`)
  const results = await response.json() as { success?: { objectId?: string }, error?: { error?: string } }[]
  return results.map((result) => {
    if (result.error) throw new Error(result.error.error || 'Parse refused a row')
    return result.success?.objectId || ''
  })
}

async function inBatches(requests: Request[], maintenance: boolean): Promise<string[]> {
  const ids: string[] = []
  for (let at = 0; at < requests.length; at += BATCH) ids.push(...await parseBatch(requests.slice(at, at + BATCH), maintenance))
  return ids
}

// ---- one row ------------------------------------------------------------------------

/** Apply `fn` to the text ids at `path` (`*` for each item); an array of ids is mapped item by item. */
function mapPath(node: unknown, path: string[], fn: (id: string) => string): void {
  if (!node || typeof node !== 'object') return
  const [head = '', ...rest] = path
  for (const key of head === '*' ? Object.keys(node) : [head]) {
    const target = node as Json
    if (rest.length) { mapPath(target[key], rest, fn); continue }
    if (typeof target[key] === 'string') target[key] = fn(target[key])
    else if (Array.isArray(target[key])) target[key] = target[key].map((item: unknown) => typeof item === 'string' ? fn(item) : item)
  }
}

/** Dates travel as ISO strings (createdAt) or Parse dates; sorted by the ones the row was created with. */
const byCreated = (a: Prepared, b: Prepared) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0

/** Types a restored file may be served as; anything else is stored as a download, so a file cannot become a page on the bucket's address. */
const SERVED_AS = new Set<string>([...ATTACHMENT_MIME_TYPES, ...Object.values(ITEM_FILE_TYPES), 'application/pdf', 'image/x-icon', 'image/vnd.microsoft.icon', 'text/plain; charset=utf-8', 'text/markdown; charset=utf-8', 'text/plain', 'text/markdown'])

function restoredHeaders(raw: unknown): Record<string, string> {
  const given = (raw && typeof raw === 'object' ? raw : {}) as Json
  const type = typeof given['Content-Type'] === 'string' ? given['Content-Type'].toLowerCase() : ''
  const safe = SERVED_AS.has(type)
  return {
    'Content-Type': safe ? type : 'application/octet-stream',
    ...(!safe ? { 'Content-Disposition': 'attachment' } : typeof given['Content-Disposition'] === 'string' ? { 'Content-Disposition': given['Content-Disposition'].slice(0, 300) } : {}),
    'Cache-Control': typeof given['Cache-Control'] === 'string' ? given['Cache-Control'].slice(0, 100) : 'private, no-store'
  }
}

/** `{ $sealed: plain }` anywhere in a value, sealed again with this instance's key. */
function sealAgain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sealAgain)
  if (value && typeof value === 'object') {
    const object = value as Json
    if (typeof object[SEALED_KEY] === 'string' && Object.keys(object).length === 1) return storeCredential(object[SEALED_KEY])
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, sealAgain(item)]))
  }
  return value
}

export type ImportProgress = (className: string, rows: Record<string, number>) => Promise<void>

/**
 * Create the rows of an export in `workspace`. `lines` is the file, one JSON
 * value per line; a first line that is not a HelpBites export is refused.
 * Returns what came in; throws, after deleting what it had created, on any failure.
 */
export async function importLines(lines: AsyncIterable<string>, workspace: ParseObject, onProgress: ImportProgress = async () => {}): Promise<TransferSummary> {
  const Parse = useParse()
  const workspaceId = workspace.id || ''
  const maintenance = !!process.env.PARSE_MAINTENANCE_KEY
  const ids = new Map<string, Map<string, string>>()
  const created: { className: string, id: string }[] = []
  const fixups: Fixup[] = []
  const summary: TransferSummary = { rows: {}, skipped: {}, projects: [], notes: [] }
  const order = IMPORT_ORDER as readonly string[]
  const resolve = (className: string, old: string) => ids.get(className)?.get(old)
  // Files a binary export carried: old key to the key it has here.
  const movedFiles = new Map<string, string>()
  const storedFiles: { key: string, bytes: number }[] = []
  const runKey = `imports/${workspaceId}/${randomBytes(6).toString('hex')}`
  let fileBase = ''
  let withSecrets = false
  let incoming: { key: string, headers: unknown, parts: Buffer[], bytes: number } | null = null
  const settingsSet: string[] = []
  const skip = (className: string, count: number, reason: string) => {
    summary.skipped[className] = { count: (summary.skipped[className]?.count || 0) + count, reason }
  }

  function prepare(className: string, data: Json, known: Set<string>): Prepared | null {
    const rule = WORKSPACE_DATA[className]!
    const body: Json = {}
    const pending: Prepared['pending'] = []
    for (const [key, value] of Object.entries(data)) {
      // Only fields the class has: a file cannot add columns to the shared schema, and a newer version's extras are ignored.
      if (['objectId', 'createdAt', 'updatedAt', 'ACL'].includes(key) || DROP_FIELDS[className]?.includes(key) || !known.has(key)) continue
      if (!isPointer(value)) { body[key] = sealAgain(movedFiles.size ? rewriteFileUrls(value, fileBase, publicBase(), movedFiles) : value); continue }
      if (value.className === 'Workspace') body[key] = pointerTo('Workspace', workspaceId)
      else if (resolve(value.className, value.objectId)) body[key] = pointerTo(value.className, resolve(value.className, value.objectId)!)
      // Not there yet (a later class, or itself): set once everything exists. Anything else is dropped.
      else if (order.includes(value.className)) pending.push({ field: key, kind: 'pointer', target: value.className, old: value.objectId })
    }
    for (const [path, target] of Object.entries(ID_PATHS[className] || {})) {
      mapPath(body, path.split('.'), id => resolve(target, id) || id)
      const single = body[path]
      if (typeof single === 'string' && single && !resolve(target, single)) pending.push({ field: path, kind: 'id', target, old: single })
    }
    // A key into the bucket: the copy this run stored, or nothing (a links export has no file to point it at).
    const keyField = FILE_KEY_FIELDS[className]
    if (keyField && body[keyField]) {
      const moved = movedFiles.get(String(body[keyField]))
      body[keyField] = moved || ''
      if (!moved && !summary.notes.includes('fileLinks')) summary.notes.push('fileLinks')
    }
    // Where a row lives is decided here, never by the file.
    if (rule.scope === 'workspace') body.workspace = pointerTo('Workspace', workspaceId)
    const parented = !!rule.parent && !!body[rule.parent.field]
    if (rule.scope === 'project' && !body.project && !parented) {
      if (!rule.orWorkspace) return null
      body.workspace = pointerTo('Workspace', workspaceId)
    }
    if (rule.scope === 'parent' && !parented) return null
    if (className === 'Sequence' && body.status === 'active') {
      body.status = 'paused'
      if (!summary.notes.includes('sequences')) summary.notes.push('sequences')
    }
    const createdAt = isoOf(data.createdAt)
    if (maintenance && createdAt) {
      body.createdAt = { __type: 'Date', iso: createdAt }
      body.updatedAt = { __type: 'Date', iso: isoOf(data.updatedAt) >= createdAt ? isoOf(data.updatedAt) : createdAt }
    }
    return { old: String(data.objectId || ''), body, pending, createdAt }
  }

  /** The projects: their public key stays when nothing else uses it, and each gets a secret of its own. */
  async function prepareProjects(rows: Prepared[]): Promise<void> {
    const wanted = rows.map(row => String(row.body.publicKey || '')).filter(Boolean)
    const taken = new Set((await new Parse.Query('Project').containedIn('publicKey', wanted).limit(1000).find(MASTER)).map(row => String(row.get('publicKey'))))
    // A file made with credentials keeps each project's secret, so the server code that holds it keeps working.
    const secrets = rows.map(row => String(row.body.secret || '')).filter(Boolean)
    const usedSecrets = new Set(secrets.length ? (await new Parse.Query('Project').containedIn('secret', secrets).limit(1000).find(MASTER)).map(row => String(row.get('secret'))) : [])
    for (const row of rows) {
      const key = String(row.body.publicKey || '')
      const keptKey = /^pk_[\da-f]{24}$/.test(key) && !taken.has(key)
      row.body.publicKey = keptKey ? key : newPublicKey()
      taken.add(row.body.publicKey)
      const secret = String(row.body.secret || '')
      const keptSecret = /^sk_[\da-f]{64}$/.test(secret) && !usedSecrets.has(secret)
      row.body.secret = keptSecret ? secret : newSecret()
      usedSecrets.add(row.body.secret)
      row.body.changelogPublicMigrated = true
      summary.projects.push({ name: String(row.body.name || ''), publicKey: row.body.publicKey, keptKey, keptSecret })
    }
  }

  /** One `_File` line: pieces are put together, and the file is stored when its last piece arrives. */
  async function takeFile(data: Json): Promise<void> {
    const key = String(data.key || '')
    if (!/^[\w][\w./-]{0,400}$/.test(key) || key.includes('..') || typeof data.b64 !== 'string') throw createError({ statusCode: 400, statusMessage: 'The file holds a file that is not valid' })
    if (data.index === 0) incoming = { key, headers: data.headers, parts: [], bytes: 0 }
    if (!incoming || incoming.key !== key) throw createError({ statusCode: 400, statusMessage: 'The file holds a file with a piece missing' })
    const piece = Buffer.from(data.b64, 'base64')
    incoming.bytes += piece.length
    if (incoming.bytes > FILE_MAX_BYTES) throw createError({ statusCode: 400, statusMessage: 'The file holds a file over 100 MB' })
    incoming.parts.push(piece)
    if (!data.last) return
    const { headers, parts, bytes } = incoming
    incoming = null
    const stored = `${runKey}/${key}`
    await storeImportedFile(stored, Buffer.concat(parts), restoredHeaders(headers), workspaceId)
    storedFiles.push({ key: stored, bytes })
    movedFiles.set(key, `${runKey}/${key}`)
    summary.files = { stored: storedFiles.length, bytes: storedFiles.reduce((sum, file) => sum + file.bytes, 0) }
  }

  /** The workspace's own AI providers and settings, put in only where this workspace has none (nothing here is overwritten). */
  async function takeSettings(data: Json): Promise<void> {
    for (const field of ['ai', 'settings']) {
      if (!data[field] || workspace.get(field)) continue
      if (field === 'ai' && !(await hasFeature(workspace, 'byoLlm'))) { skip(WORKSPACE_SETTINGS_CLASS, 1, 'AI providers are not included in this workspace\'s plan'); continue }
      workspace.set(field, sealAgain(data[field]))
      settingsSet.push(field)
    }
    if (!settingsSet.length) return
    await workspace.save(null, MASTER)
    await invalidate('workspace', workspaceId)
  }

  let current = ''
  let buffer: Json[] = []

  async function flush(): Promise<void> {
    const className = current
    const rows = buffer
    buffer = []
    if (!rows.length) return
    const feature = CLASS_FEATURES[className]
    if (feature && !(await hasFeature(workspace, feature))) return skip(className, rows.length, 'not included in this workspace\'s plan')

    const known = new Set(Object.keys((await new Parse.Schema(className).get()).fields))
    const prepared = rows.flatMap((data) => { const row = prepare(className, data, known); return row ? [row] : [] })
    if (prepared.length < rows.length) skip(className, rows.length - prepared.length, 'does not belong to anything in this file')
    // What will really be created counts against the plan, before any of it is.
    const gauge = CLASS_GAUGES[className]
    if (gauge) await checkGauge(workspace, gauge, prepared.length)
    if (!maintenance) prepared.sort(byCreated)
    if (className === 'Project') await prepareProjects(prepared)

    const made = await inBatches(prepared.map(row => ({ method: 'POST', path: `/classes/${className}`, body: row.body })), maintenance)
    const map = ids.get(className) || ids.set(className, new Map()).get(className)!
    prepared.forEach((row, at) => {
      map.set(row.old, made[at]!)
      created.push({ className, id: made[at]! })
      for (const item of row.pending) fixups.push({ ...item, className, id: made[at]! })
    })
    summary.rows[className] = (summary.rows[className] || 0) + prepared.length
    await onProgress(className, summary.rows)
  }

  async function applyFixups(): Promise<void> {
    const requests: Request[] = []
    for (const item of fixups) {
      const id = resolve(item.target, item.old)
      if (id) requests.push({ method: 'PUT', path: `/classes/${item.className}/${item.id}`, body: { [item.field]: item.kind === 'pointer' ? pointerTo(item.target, id) : id } })
    }
    await inBatches(requests, maintenance)
  }

  try {
    let header = false
    for await (const line of lines) {
      if (!line.trim()) continue
      let row: Json
      try { row = JSON.parse(line) } catch { throw createError({ statusCode: 400, statusMessage: 'This is not a HelpBites export (a line is not JSON)' }) }
      if (!header) {
        if (row.format !== EXPORT_FORMAT || !EXPORT_VERSIONS.includes(row.version)) throw createError({ statusCode: 400, statusMessage: 'This is not a HelpBites export, or it is from a newer version than this instance understands' })
        header = true
        fileBase = typeof row.fileBase === 'string' ? row.fileBase : ''
        withSecrets = row.secrets === true
        const files: TransferFiles = readTransferFiles(row.files)
        if (files === 'binary' && (!s3Configured() || !publicBase())) throw createError({ statusCode: 503, statusMessage: 'This file carries its uploaded files: importing it needs file storage here (the server\'s S3_* settings, with S3_PUBLIC_URL)' })
        continue
      }
      const className = String(row.class || '')
      if (!row.data || typeof row.data !== 'object') continue
      if (className === FILE_CLASS || className === WORKSPACE_SETTINGS_CLASS) {
        // Files are put away as they come, before the rows that use them are made.
        if (!s3Configured() && className === FILE_CLASS) throw createError({ statusCode: 503, statusMessage: 'This file carries its uploaded files: importing it needs file storage here (the server\'s S3_* settings)' })
        await (className === FILE_CLASS ? takeFile(row.data) : takeSettings(row.data))
        continue
      }
      // A connection written without its credentials would come in unable to connect: leave it out.
      if (CREDENTIAL_CLASSES.includes(className) && !withSecrets) { skip(className, 1, 'exported without credentials; connect it again'); continue }
      if (!order.includes(className)) {
        if (WORKSPACE_DATA[className]) skip(className, 1, NOT_PORTABLE[className] || 'not part of an import')
        continue
      }
      if (className !== current) { await flush(); current = className }
      if (!maintenance && buffer.length >= SORT_LIMIT) throw createError({ statusCode: 400, statusMessage: `${className} has more than ${SORT_LIMIT} rows: set PARSE_MAINTENANCE_KEY (docs/TRANSFER.md) to import this much` })
      buffer.push(row.data)
    }
    if (!header) throw createError({ statusCode: 400, statusMessage: 'The file is empty' })
    await flush()
    await applyFixups()
  } catch (error) {
    await rollback(created.reverse(), maintenance)
    if (storedFiles.length) await removeImportedFiles(storedFiles, workspaceId).catch(() => {})
    if (settingsSet.length) {
      for (const field of settingsSet) workspace.unset(field)
      await workspace.save(null, MASTER).catch(() => {})
      await invalidate('workspace', workspaceId).catch(() => {})
    }
    await forgetWorkspaceProjects(workspaceId)
    throw error
  }
  await forgetWorkspaceProjects(workspaceId)
  await afterImport([...(ids.get('Project')?.values() || [])], [...(ids.get('KnowledgeModel')?.values() || [])], workspaceId).catch(error => console.warn('[transfer] search not refreshed:', (error as Error).message))
  return summary
}

async function rollback(created: { className: string, id: string }[], maintenance: boolean): Promise<void> {
  for (let at = 0; at < created.length; at += BATCH) {
    await parseBatch(created.slice(at, at + BATCH).map(({ className, id }) => ({ method: 'DELETE', path: `/classes/${className}/${id}` })), maintenance).catch(error => console.error('[transfer] rollback:', (error as Error).message))
  }
}

/** Put what came in into search and have the knowledge indexed (both best effort, like any write). */
async function afterImport(projectIds: string[], modelIds: string[], workspaceId: string): Promise<void> {
  const Parse = useParse()
  for (const modelId of modelIds) await enqueueJob('knowledge.index', { modelId, all: true }, { workspaceId })
  if (!meiliConfigured() || !projectIds.length) return
  const projects = projectIds.map(id => Parse.Object.extend('Project').createWithoutData(id))
  for await (const rows of pagedRows(() => new Parse.Query('EndUser').containedIn('project', projects))) await syncEndUsersForSearch(rows)
  for await (const rows of pagedRows(() => new Parse.Query('Conversation').containedIn('project', projects).include('endUser'))) {
    for (const row of rows) await syncConversationForSearch(row)
  }
}

// ---- reading a file --------------------------------------------------------------------

/** The longest line of an export: its biggest rows are a template's HTML (2 MB) or a CMS page. A file with a line past this is a bomb, not an export. */
export const MAX_LINE_CHARS = 16 * 1024 * 1024

/** The lines of a gzipped JSON Lines stream. */
export async function* linesOf(input: NodeJS.ReadableStream): AsyncGenerator<string> {
  const gunzip = createGunzip()
  input.on('error', error => gunzip.destroy(error))
  input.pipe(gunzip)
  gunzip.setEncoding('utf8')
  let rest = ''
  for await (const chunk of gunzip as AsyncIterable<string>) {
    rest += chunk
    if (rest.length > MAX_LINE_CHARS && !rest.includes('\n')) throw createError({ statusCode: 400, statusMessage: 'The file has a line longer than 16 MB: it is not a HelpBites export' })
    for (let at = rest.indexOf('\n'); at >= 0; at = rest.indexOf('\n')) {
      yield rest.slice(0, at)
      rest = rest.slice(at + 1)
    }
  }
  if (rest) yield rest
}

// ---- pulling from another instance ------------------------------------------------------

export type TransferSource = { url: string, apiKey?: string, login?: string, password?: string, workspaceId?: string }

/** A request body's `source`, as strings only. */
export function readSource(raw: unknown): TransferSource {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Json
  const text = (key: string) => typeof input[key] === 'string' ? input[key].trim() : ''
  return { url: text('url'), apiKey: text('apiKey'), login: text('login'), password: typeof input.password === 'string' ? input.password : '', workspaceId: text('workspaceId') }
}

function sourceBase(url: string): string {
  let parsed: URL
  try { parsed = new URL(String(url || '').trim()) } catch { throw createError({ statusCode: 400, statusMessage: 'That is not a URL' }) }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw createError({ statusCode: 400, statusMessage: 'Only http(s) URLs' })
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '').replace(/\/v1(\/.*)?$/, '')}`
}

function sourceFailure(status: number, what: string) {
  const reason = status === 401 ? 'rejected those credentials'
    : status === 403 ? 'does not let that account export (an owner or admin can)'
      : status === 404 ? 'does not support transfers yet: update it, or use a file'
        : status === 429 ? 'is rate limiting this; try again later'
          : `answered ${status}`
  return createError({ statusCode: 400, statusMessage: `The other instance ${reason}${what ? ` (${what})` : ''}` })
}

/** Sign in to the other instance: an admin API key as it is, a username and password for a session that is signed out again after. */
async function signIn(base: string, source: TransferSource): Promise<{ token: string, signOut: () => Promise<void> }> {
  if (source.apiKey) {
    if (!source.apiKey.startsWith('ak_')) throw createError({ statusCode: 400, statusMessage: 'An admin API key starts with ak_' })
    return { token: source.apiKey, signOut: async () => {} }
  }
  if (!source.login || !source.password) throw createError({ statusCode: 400, statusMessage: 'Give an admin API key, or a username and password' })
  const response = await safeFetch(`${base}/v1/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: source.login, password: source.password }) })
  if (!response.ok) throw sourceFailure(response.status, 'sign in')
  const token = String(((await response.json().catch(() => ({}))) as Json).sessionToken || '')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'The other instance did not answer like a HelpBites' })
  return { token, signOut: async () => { await safeFetch(`${base}/v1/admin/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {}) } }
}

// The workspace file itself is as big as the workspace (the upload route caps it at 2 GiB too); everything else the other instance says is small.
const PULL_MAX_BYTES = 2 * 1024 * 1024 * 1024

const sourceGet = (base: string, path: string, token: string, workspaceId = '', timeoutMs?: number) =>
  safeFetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, ...(workspaceId ? { 'X-Workspace': workspaceId } : {}) }, ...(timeoutMs ? { timeoutMs, maxBytes: PULL_MAX_BYTES } : {}) })

/** What the other instance holds that can be moved: its workspaces and the projects of the one chosen. */
export async function inspectSource(source: TransferSource) {
  const base = sourceBase(source.url)
  const auth = await signIn(base, source)
  try {
    const me = await sourceGet(base, '/v1/admin/me', auth.token, source.workspaceId)
    if (!me.ok) throw sourceFailure(me.status, 'who you are')
    const who = await me.json() as Json
    if (!who.workspace) throw createError({ statusCode: 400, statusMessage: 'That account is not a member of any workspace there' })
    if (!['owner', 'admin'].includes(who.role)) throw createError({ statusCode: 400, statusMessage: 'You need to be an owner or admin of that workspace to export it' })
    const projects = await sourceGet(base, '/v1/admin/projects', auth.token, who.workspace.id)
    if (!projects.ok) throw sourceFailure(projects.status, 'projects')
    return {
      host: new URL(base).host,
      edition: String(who.edition || ''),
      workspace: { id: String(who.workspace.id), name: String(who.workspace.name || '') },
      workspaces: (who.workspaces as Json[] || []).map(item => ({ id: String(item.id), name: String(item.name || '') })),
      projects: ((await projects.json() as Json).projects as Json[] || []).map(item => ({ id: String(item.id), name: String(item.name || '') }))
    }
  } finally {
    await auth.signOut()
  }
}

async function openPull(source: TransferSource, projectId: string, options: TransferOptions): Promise<{ stream: Readable, close: () => Promise<void> }> {
  const base = sourceBase(source.url)
  const auth = await signIn(base, source)
  try {
    const query = new URLSearchParams({ ...(projectId ? { project: projectId } : {}), include: 'importable', files: options.files, ...(options.secrets ? { secrets: '1' } : {}) })
    const response = await sourceGet(base, `/v1/admin/transfers/export?${query}`, auth.token, source.workspaceId, PULL_MS)
    if (!response.ok || !response.body) throw sourceFailure(response.status, 'export')
    return { stream: Readable.fromWeb(response.body as never), close: auth.signOut }
  } catch (error) {
    await auth.signOut()
    throw error
  }
}

// ---- the transfer as a record and a job ---------------------------------------------------------

export function serializeTransfer(row: ParseObject) {
  return {
    id: row.id || '',
    source: String(row.get('source') || 'file'),
    host: String(row.get('host') || ''),
    scope: String(row.get('scope') || 'workspace') as TransferScope,
    status: String(row.get('status') || 'queued'),
    files: readTransferFiles(row.get('files')),
    secrets: row.get('secrets') === true,
    progress: (row.get('progress') || null) as { className: string, rows: Record<string, number> } | null,
    summary: (row.get('summary') || null) as TransferSummary | null,
    error: String(row.get('error') || ''),
    createdAt: iso(row.createdAt),
    finishedAt: iso(row.get('finishedAt'))
  }
}

export async function listTransfers(workspace: ParseObject): Promise<ReturnType<typeof serializeTransfer>[]> {
  const rows = await new (useParse()).Query('DataTransfer').equalTo('workspace', workspace).descending('createdAt').limit(20).find(MASTER)
  return rows.map(serializeTransfer)
}

/** Record an import and queue it. One at a time per workspace. */
export async function queueTransfer(ctx: MemberContext, fields: Record<string, unknown>, ip = ''): Promise<ParseObject> {
  const Parse = useParse()
  await rateLimit(`sb:rl:transfer:${ctx.workspaceId}`, 10, 3600)
  const running = await new Parse.Query('DataTransfer').equalTo('workspace', ctx.workspace).containedIn('status', ['queued', 'running']).first(MASTER)
  if (running) throw createError({ statusCode: 409, statusMessage: 'An import is already running in this workspace' })
  const row = new (Parse.Object.extend('DataTransfer'))() as ParseObject
  row.set('workspace', ctx.workspace)
  row.set('createdBy', ctx.agentId)
  row.set('status', 'queued')
  for (const [key, value] of Object.entries(fields)) row.set(key, value)
  await row.save(null, MASTER)
  await enqueueJob('workspace.transfer', { transferId: row.id }, { workspaceId: ctx.workspaceId, dedupeKey: `workspace.transfer:${row.id}` })
  await audit({ action: 'workspace.import', actor: ctx.agent, workspace: ctx.workspace, data: { source: fields.source, host: fields.host || '', scope: fields.scope }, ip })
  return row
}

/** Queue a pull from another instance. The login is sealed on the record and removed when the import ends. */
export async function queuePull(ctx: MemberContext, source: TransferSource, projectId: string, options: TransferOptions = { files: 'urls', secrets: false }, ip = ''): Promise<ParseObject> {
  const base = sourceBase(source.url)
  const credential = sealSecret(JSON.stringify({ url: base, apiKey: source.apiKey, login: source.login, password: source.password, workspaceId: source.workspaceId }))
  return await queueTransfer(ctx, { source: 'instance', host: new URL(base).host, scope: projectId ? 'project' : 'workspace', sourceProjectId: projectId, files: options.files, secrets: options.secrets, credential }, ip)
}

/** Store an uploaded export (gzipped or not) and queue its import. */
export async function queueUpload(ctx: MemberContext, body: ReadableStream<Uint8Array> | null, size: number, ip = ''): Promise<ParseObject> {
  if (!s3Configured()) throw createError({ statusCode: 503, statusMessage: 'Importing a file needs file storage: set the server\'s S3_* settings' })
  if (!body || !size) throw createError({ statusCode: 400, statusMessage: 'Send the export file as the request body' })
  if (size > MAX_UPLOAD_BYTES) throw createError({ statusCode: 413, statusMessage: 'That file is too large; import it straight from the other instance instead' })
  const key = `exports/${ctx.workspaceId}/import-${randomBytes(8).toString('hex')}.jsonl.gz`
  const file = join(tmpdir(), `helpbites-import-${randomBytes(8).toString('hex')}`)
  try {
    const chunks = Readable.fromWeb(body as never)
    // The file's first two bytes tell a gzip (1f 8b) from plain JSON Lines, which is compressed on the way in.
    const iterator = chunks[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) throw createError({ statusCode: 400, statusMessage: 'The file is empty' })
    const head = first.value as Buffer
    const zipped = head[0] === 0x1f && head[1] === 0x8b
    let received = 0
    const rest = Readable.from((async function* () {
      let next: IteratorResult<Buffer> = first
      for (; !next.done; next = await iterator.next()) {
        received += next.value.length
        if (received > MAX_UPLOAD_BYTES) throw createError({ statusCode: 413, statusMessage: 'That file is too large; import it straight from the other instance instead' })
        yield next.value
      }
    })())
    const out = createWriteStream(file)
    await (zipped ? pipeline(rest, out) : pipeline(rest, createGzip(), out))
    await storePrivateFile(key, file, { 'Content-Type': 'application/gzip' })
  } finally {
    await unlink(file).catch(() => {})
  }
  return await queueTransfer(ctx, { source: 'file', scope: 'workspace', uploadKey: key }, ip)
}

/** The `workspace.transfer` job. */
export async function runTransfer(transferId: string): Promise<void> {
  const row = await new (useParse()).Query('DataTransfer').get(transferId, MASTER).catch(() => null)
  if (!row) return
  const done = async (status: 'done' | 'failed', patch: Record<string, unknown>) => {
    row.set('status', status)
    for (const [key, value] of Object.entries(patch)) row.set(key, value)
    row.unset('credential')
    row.set('finishedAt', new Date())
    await row.save(null, MASTER)
  }
  // Run again after a crash: what the first run did is not known, so say so rather than doing it twice.
  if (row.get('status') === 'running') return await done('failed', { error: 'The server restarted during the import, so some of it may have come in. Check the projects, delete what is half there, and import again.' })
  if (row.get('status') !== 'queued') return

  const workspace = await getWorkspace(pointerId(row.get('workspace')))
  if (!workspace || String(workspace.get('status') || 'active') !== 'active') return await done('failed', { error: 'The workspace is not active' })
  row.set('status', 'running')
  row.set('startedAt', new Date())
  await row.save(null, MASTER)

  let close = async () => {}
  try {
    let input: NodeJS.ReadableStream
    if (row.get('source') === 'file') {
      input = await readObjectStream(String(row.get('uploadKey')))
    } else {
      const source = JSON.parse(openSealedSecret(String(row.get('credential')))) as TransferSource
      const pull = await openPull(source, String(row.get('sourceProjectId') || ''), { files: readTransferFiles(row.get('files')), secrets: row.get('secrets') === true })
      input = pull.stream
      close = pull.close
    }
    const summary = await importLines(linesOf(input), workspace, async (className, rows) => {
      row.set('progress', { className, rows })
      await row.save(null, MASTER)
    })
    await done('done', { summary })
  } catch (error) {
    const message = (error as { statusMessage?: string }).statusMessage || (error as Error).message || 'The import failed'
    console.error('[transfer] failed:', message)
    await done('failed', { error: message.slice(0, 500) })
  } finally {
    await close().catch(() => {})
    const key = String(row.get('uploadKey') || '')
    if (key) await removeObjectsUnder(key).catch(() => {})
  }
}
