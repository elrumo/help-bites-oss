import { randomBytes } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import type { EmailDocument } from '#shared/email/blocks'
import { MAX_DOCUMENT_CHARS } from '#shared/email/ops'
import { extractTemplateVariables } from '#shared/email/placeholders'
import { renderEmailHtml } from '#shared/email/render'
import { applyProjectAccent, BRAND_VARIABLE_PREFIX, plainTextFor, RECIPIENT_VARIABLE_PREFIX, resolveTemplate, type EmailBrand, type TemplateVariable } from '#shared/email/resolve'

// Email templates. One class, three kinds of row:
//
//   master   no project — designed once, reused by every project
//   linked   a project's link to a master: no document of its own, only the
//            project's values for the master's variables (plus its send key)
//   own      a project's own template, or a detached copy of a master
//
// Operators edit everything. A share link opens one template to anyone who
// has it: view-only, or editable (never for a linked row — its document is
// the master's).

export type ShareMode = 'view' | 'edit'

export type EmailMasterSummary = { id: string, name: string, document: EmailDocument | null, variables: TemplateVariable[], updatedAt: number }

export type EmailTemplate = {
  id: string
  projectId: string | null
  masterId: string | null
  folderId: string | null
  /** The send-API handle, unique within a project. */
  key: string
  name: string
  description: string
  document: EmailDocument | null
  variables: TemplateVariable[]
  variableValues: Record<string, string>
  shareMode: ShareMode | null
  shareToken: string | null
  lastActorId: string | null
  updatedAt: number
  /** The linked master's design (linked rows only). */
  master: EmailMasterSummary | null
}

export type EmailFolder = { id: string, projectId: string | null, parentId: string | null, name: string }

const KEY_RE = /^[a-zA-Z0-9_.-]+$/

function millis(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0
}

/** Stored as [{ key, value }]: variable keys may contain dots, which Parse refuses as object keys. */
function readValues(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(value)) for (const v of value) if (v && typeof v.key === 'string') out[v.key] = String(v.value ?? '')
  return out
}

export function storeValues(row: ParseObject, values: Record<string, string>): void {
  row.set('values', Object.entries(values).map(([key, value]) => ({ key, value })))
}

function readVariables(value: unknown): TemplateVariable[] {
  return Array.isArray(value) ? value.filter(v => v && typeof v.key === 'string') : []
}

export function serializeEmailTemplate(row: ParseObject, options: { forShare?: boolean } = {}): EmailTemplate {
  const master = row.get('master') as ParseObject | undefined
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')) || null,
    masterId: master?.id || null,
    folderId: pointerId(row.get('folder')) || null,
    key: String(row.get('key') || ''),
    name: String(row.get('name') || ''),
    description: String(row.get('description') || ''),
    document: (row.get('document') as EmailDocument) || null,
    variables: readVariables(row.get('variables')),
    variableValues: readValues(row.get('values')),
    shareMode: (row.get('shareMode') as ShareMode) || null,
    shareToken: options.forShare ? null : (row.get('shareToken') as string) || null,
    lastActorId: (row.get('lastActorId') as string) || null,
    updatedAt: millis(row.updatedAt),
    // `include('master')` fetched it; a bare pointer has no name yet.
    master: master?.get('name') !== undefined
      ? { id: master.id || '', name: String(master.get('name') || ''), document: (master.get('document') as EmailDocument) || null, variables: readVariables(master.get('variables')), updatedAt: millis(master.updatedAt) }
      : null
  }
}

export function serializeEmailFolder(row: ParseObject): EmailFolder {
  return { id: row.id || '', projectId: pointerId(row.get('project')) || null, parentId: pointerId(row.get('parent')) || null, name: String(row.get('name') || '') }
}

export async function getEmailTemplate(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('EmailTemplate').include('master').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Email template not found' })
  }
}

export async function getEmailFolder(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('EmailFolder').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Folder not found' })
  }
}

// ---- input -----------------------------------------------------------------

export function slugKey(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** One project's templates, or (no project) one workspace's masters. */
function templatesIn(projectId: string | null, workspaceId: string) {
  const Parse = useParse()
  const query = new Parse.Query('EmailTemplate').equalTo('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId))
  if (projectId) query.equalTo('project', Parse.Object.extend('Project').createWithoutData(projectId))
  else query.doesNotExist('project')
  return query
}

/** The wanted key, or the first free `key-2`, `key-3`… in that project (or among the workspace's masters). */
export async function freeKey(projectId: string | null, workspaceId: string, wanted: string): Promise<string> {
  const base = slugKey(wanted) || 'email'
  const taken = new Set((await templatesIn(projectId, workspaceId).startsWith('key', base).select('key').limit(1000).find(MASTER)).map(r => r.get('key')))
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}-${i}`
    if (!taken.has(key)) return key
  }
}

function hasUnstorableKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnstorableKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([k, v]) => k.includes('.') || k.startsWith('$') || hasUnstorableKey(v))
}

export function validateDocument(value: unknown): EmailDocument {
  const doc = value as EmailDocument
  if (!doc || typeof doc !== 'object' || !doc.settings || typeof doc.settings !== 'object' || !Array.isArray(doc.blocks)) {
    throw createError({ statusCode: 400, statusMessage: 'document must be { settings, blocks[] }' })
  }
  if (JSON.stringify(doc).length > MAX_DOCUMENT_CHARS) throw createError({ statusCode: 413, statusMessage: 'Email document is too large' })
  if (hasUnstorableKey(doc)) throw createError({ statusCode: 400, statusMessage: 'Document keys may not contain "." or start with "$"' })
  return doc
}

/** Keep declared labels/defaults for placeholders still in the document; drop the rest. */
export function reconcileVariables(doc: EmailDocument, declared: unknown): TemplateVariable[] {
  const byKey = new Map(readVariables(declared).map(v => [v.key, v]))
  return extractTemplateVariables(doc).map((key) => {
    const v = byKey.get(key)
    return {
      key,
      ...(typeof v?.label === 'string' && v.label.trim() ? { label: v.label.trim().slice(0, 120) } : {}),
      ...(typeof v?.defaultValue === 'string' ? { defaultValue: v.defaultValue.slice(0, 2000) } : {})
    }
  })
}

/**
 * A project's (or a caller's) values. `project.*` keys always come from the
 * project itself and `recipient.*` from the message. Values may be long: a
 * pre-rendered `{{{list}}}` is a whole section of the email.
 */
export function cleanVariableValues(value: unknown, maxLength = 2000): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (!KEY_RE.test(key) || key.startsWith(BRAND_VARIABLE_PREFIX) || key.startsWith(RECIPIENT_VARIABLE_PREFIX) || v == null) continue
    out[key] = String(v).slice(0, maxLength)
  }
  return out
}

async function assertFolderScope(folderId: string, projectId: string | null, workspaceId: string): Promise<ParseObject> {
  const folder = await getEmailFolder(folderId)
  if (pointerId(folder.get('workspace')) !== workspaceId) throw createError({ statusCode: 404, statusMessage: 'Folder not found' })
  if ((pointerId(folder.get('project')) || null) !== projectId) throw createError({ statusCode: 400, statusMessage: 'That folder belongs to another project' })
  return folder
}

/**
 * Apply a PATCH body. A share-link editor may change the design and nothing
 * else; a linked row's design is the master's, so it only takes values.
 */
export async function applyEmailInput(row: ParseObject, input: Record<string, unknown>, options: { shared?: boolean } = {}): Promise<void> {
  const linked = Boolean(row.get('master'))
  const projectId = pointerId(row.get('project')) || null
  const workspaceId = pointerId(row.get('workspace'))

  if (!options.shared) {
    if (typeof input.name === 'string' && input.name.trim()) row.set('name', input.name.trim().slice(0, 120))
    if ('description' in input) row.set('description', String(input.description || '').trim().slice(0, 500))
    if (typeof input.key === 'string') {
      const key = slugKey(input.key)
      if (!key) throw createError({ statusCode: 400, statusMessage: 'key needs at least one letter or digit' })
      if (key !== row.get('key')) {
        const clash = await templatesIn(projectId, workspaceId).equalTo('key', key).first(MASTER)
        if (clash && clash.id !== row.id) throw createError({ statusCode: 409, statusMessage: `Another template in this project already uses the key "${key}"` })
        row.set('key', key)
      }
    }
    if ('folder' in input) {
      if (input.folder) row.set('folder', await assertFolderScope(String(input.folder), projectId, workspaceId))
      else row.unset('folder')
    }
    if (linked && input.variableValues !== undefined) storeValues(row, cleanVariableValues(input.variableValues))
  }

  if (!linked && (input.document !== undefined || input.variables !== undefined)) {
    const doc = input.document !== undefined ? validateDocument(input.document) : (row.get('document') as EmailDocument)
    if (input.document !== undefined) row.set('document', doc)
    row.set('variables', reconcileVariables(doc, input.variables ?? row.get('variables')))
  }
  // Live-sync echo suppression: the tab that saved ignores its own update.
  row.set('lastActorId', typeof input.actorId === 'string' ? input.actorId.slice(0, 64) : '')
}

/** Detach a linked row: bake the project's accent and values into its own copy, so it looks the same afterwards. */
export function detachEmailTemplate(row: ParseObject, project: ParseObject): void {
  const master = row.get('master') as ParseObject
  const values = readValues(row.get('values'))
  const doc = applyProjectAccent(master.get('document') as EmailDocument, brandOf(project).theme?.accent)
  row.set('document', doc)
  row.set('variables', readVariables(master.get('variables')).map(v => (values[v.key] !== undefined ? { ...v, defaultValue: values[v.key] } : v)))
  row.set('values', [])
  row.unset('master')
}

// ---- rendering -------------------------------------------------------------

export function brandOf(project: ParseObject): EmailBrand {
  return {
    name: String(project.get('name') || ''),
    brandLogoUrl: String(project.get('brandLogoUrl') || ''),
    siteUrl: String(project.get('siteUrl') || ''),
    theme: (project.get('theme') as EmailBrand['theme']) || {},
    address: String((project.get('marketing') as { postalAddress?: string } | undefined)?.postalAddress || '')
  }
}

/** Subject, HTML and text exactly as the send API delivers them. */
export function renderEmailTemplate(row: ParseObject, project: ParseObject | null, values: Record<string, string> = {}) {
  const template = serializeEmailTemplate(row)
  if (template.masterId && !template.master) throw new Error('renderEmailTemplate needs the master included')
  const { subject, document } = resolveTemplate(template, { master: template.master, brand: project ? brandOf(project) : null, values })
  const html = renderEmailHtml(document)
  return { subject, html, text: plainTextFor(document, html) }
}

// ---- public API ------------------------------------------------------------

/** A project's template by send key, or by id. Masters are included for rendering. */
export async function findProjectEmail(project: ParseObject, ref: string): Promise<ParseObject> {
  const by = (field: string) => new (useParse()).Query('EmailTemplate').equalTo('project', project).equalTo(field, ref).include('master').first(MASTER)
  const row = ref ? await by('key') || await by('objectId') : null
  if (!row) throw createError({ statusCode: 404, statusMessage: `No email template "${ref.slice(0, 100)}" in this project` })
  return row
}

/**
 * Who may read a rendered template: a project secret reads its own project's
 * templates by key or id; an operator session or admin key reads any template
 * of its workspace by id (a master renders with its sample values).
 */
export async function findEmailForApi(event: H3Event, ref: string): Promise<{ row: ParseObject, project: ParseObject | null }> {
  if (optionalBearer(event).startsWith('sk_')) {
    const project = await requireProjectSecret(event)
    return { row: await findProjectEmail(project, ref), project }
  }
  const row = await scoped.emailTemplate(await requireMember(event), ref)
  const projectId = pointerId(row.get('project'))
  return { row, project: projectId ? await loadProjectUnscoped(projectId) : null }
}

// ---- sharing and live sync -------------------------------------------------

export function newShareToken(): string {
  return randomBytes(18).toString('base64url')
}

/** Resolve a share link; `edit` also requires the link to have been shared for editing. */
export async function findSharedEmail(event: H3Event, token: string, need: ShareMode): Promise<ParseObject> {
  await rateLimit(`sb:rl:emailshare:${clientIp(event) || 'ip'}`, LIMITS.emailSharePerIp.limit, LIMITS.emailSharePerIp.window)
  const row = token ? await new (useParse()).Query('EmailTemplate').equalTo('shareToken', token).include(['master', 'project']).first(MASTER) : null
  const mode = row?.get('shareMode') as ShareMode | undefined
  if (!row || !mode) throw createError({ statusCode: 404, statusMessage: 'This share link is no longer active' })
  if (need === 'edit' && mode !== 'edit') throw createError({ statusCode: 403, statusMessage: 'This link is view-only' })
  return row
}

export async function saveAndBroadcast(row: ParseObject): Promise<EmailTemplate> {
  await row.save(null, MASTER)
  const template = serializeEmailTemplate(row)
  await publishEmailEvent({ type: 'email.updated', templateId: template.id, template: { ...template, shareToken: null } })
  return template
}

// ---- AI designer chats ------------------------------------------------------
// A template has any number of chats: runs of EmailChatMessage rows sharing
// the `chatId` the editor picked. Rows from before chats existed have none and
// read as one chat, "legacy".

export const LEGACY_EMAIL_CHAT = 'legacy'

export type EmailChatSummary = { id: string, title: string, updatedAt: string }

/** A chat id from a request. */
export function emailChatId(value: unknown): string {
  const id = String(value ?? '')
  if (!/^[\w-]{1,64}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid chat id' })
  return id
}

function chatRows(template: ParseObject, chatId: string) {
  const query = new (useParse()).Query('EmailChatMessage').equalTo('template', template)
  return chatId === LEGACY_EMAIL_CHAT ? query.doesNotExist('chatId') : query.equalTo('chatId', chatId)
}

/** A stored message's words on one line, for a chat's title. */
function chatTitle(row: ParseObject): string {
  try {
    const parts = JSON.parse(String(row.get('content') || '[]')) as { type?: string, text?: string }[]
    return parts.filter(p => p.type === 'text').map(p => p.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  } catch {
    return ''
  }
}

/** Chats asked in most recently first, each titled with its first question. */
export async function listEmailChats(template: ParseObject): Promise<EmailChatSummary[]> {
  const rows = await new (useParse()).Query('EmailChatMessage').equalTo('template', template).equalTo('role', 'user').descending('createdAt').select('chatId', 'content').limit(1000).find(MASTER)
  const chats = new Map<string, EmailChatSummary>()
  for (const row of rows) {
    const id = String(row.get('chatId') || LEGACY_EMAIL_CHAT)
    const chat = chats.get(id) || { id, title: '', updatedAt: (row.createdAt as Date).toISOString() }
    // Newest first, so a chat's first question is the last one seen.
    chat.title = chatTitle(row) || chat.title
    chats.set(id, chat)
  }
  return [...chats.values()]
}

/** The chat asked in most recently, or null before anyone has asked anything. */
export async function latestEmailChatId(template: ParseObject): Promise<string | null> {
  const row = await new (useParse()).Query('EmailChatMessage').equalTo('template', template).equalTo('role', 'user').descending('createdAt').select('chatId').first(MASTER)
  return row ? String(row.get('chatId') || LEGACY_EMAIL_CHAT) : null
}

export async function deleteEmailChat(template: ParseObject, chatId: string): Promise<void> {
  await eachBatch(() => chatRows(template, chatId), rows => useParse().Object.destroyAll(rows, MASTER), { keys: ['objectId'] })
}

/**
 * Parts are stored as JSON text: tool inputs may carry keys Parse refuses in
 * nested objects. Trying a turn again resends its message: that stays stored
 * once, and the reply it replaces is dropped.
 */
export async function saveEmailChatMessage(template: ParseObject, chatId: string, message: { id?: string, role: string, parts?: unknown[] }, meta: { tier: string, agent?: ParseObject }): Promise<void> {
  const Parse = useParse()
  const clientId = String(message.id || '').slice(0, 64)
  const sent = clientId ? await chatRows(template, chatId).equalTo('clientId', clientId).first(MASTER) : undefined
  if (sent) {
    const replaced = await chatRows(template, chatId).greaterThan('createdAt', sent.createdAt).limit(1000).find(MASTER)
    if (replaced.length) await Parse.Object.destroyAll(replaced, MASTER)
    return
  }
  const row = new (Parse.Object.extend('EmailChatMessage'))()
  row.set('template', template)
  if (chatId !== LEGACY_EMAIL_CHAT) row.set('chatId', chatId)
  row.set('clientId', clientId)
  row.set('role', message.role === 'assistant' ? 'assistant' : 'user')
  // A whole set_document input is the design itself, already saved on the template.
  const parts = (message.parts || []).map((p: any) => (p?.type === 'tool-set_document' ? { ...p, input: { document: '(saved on the template)' } } : p))
  row.set('content', JSON.stringify(parts))
  row.set('tier', meta.tier)
  if (meta.agent) row.set('agent', meta.agent)
  await row.save(null, MASTER)
}

export async function listEmailChat(template: ParseObject, chatId: string): Promise<{ id: string, role: 'user' | 'assistant', parts: unknown[] }[]> {
  const rows = await chatRows(template, chatId).descending('createdAt').limit(60).find(MASTER)
  return rows.reverse().map((r) => {
    let parts: unknown[] = []
    try {
      parts = JSON.parse(String(r.get('content') || '[]'))
    } catch {}
    return { id: String(r.get('clientId') || r.id), role: r.get('role') === 'assistant' ? 'assistant' : 'user', parts }
  })
}

