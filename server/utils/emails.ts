import { randomBytes } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import type { EmailDocument } from '#shared/email/blocks'
import { localizeEmail, type EmailStrings } from '#shared/email/translate'
import { DEFAULT_CONTENT_LOCALE, matchLocale, normalizeLocale } from '#shared/locales'
import { MAX_DOCUMENT_CHARS } from '#shared/email/ops'
import { extractTemplateVariables } from '#shared/email/placeholders'
import { renderEmailHtml } from '#shared/email/render'
import { applyProjectAccent, brandAccentOf, BRAND_VARIABLE_PREFIX, plainTextFor, RECIPIENT_VARIABLE_PREFIX, resolveTemplate, type EmailBrand, type TemplateVariable } from '#shared/email/resolve'
import { companyOf } from './company'
import { legalLinksOf } from './legalLinks'
import { lookOf } from './projects'

// Email templates. One class, three kinds of row:
//
//   master   no project — designed once, reused by every project
//   linked   a project's link to a master: no document of its own, only the
//            project's values for the master's variables (plus its send key)
//   own      a project's own template, or a detached copy of a master
//
// Operators edit everything. A share link opens one template to anyone who
// has it until it expires: view-only, or editable. Never editable for a
// master or linked row (the edit would reach every project using the
// design) or for mail the server sends itself.

export type ShareMode = 'view' | 'edit'

export type EmailMasterSummary = { id: string, name: string, document: EmailDocument | null, variables: TemplateVariable[], locale: string, translations: EmailTranslations, updatedAt: number }

/** A template's other languages: `{ es: { subject: '…', '<blockId>#label': '…' } }` (keys in shared/email/translate.ts). */
export type EmailTranslations = Record<string, EmailStrings>

export const EMAIL_MAX_TRANSLATIONS = 20

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
  /** The language the design is written in. */
  locale: string
  translations: EmailTranslations
  shareMode: ShareMode | null
  shareToken: string | null
  /** When the share link stops working; null when it has no date (not shared, or shared before links expired). */
  shareExpiresAt: number | null
  /** The last save made through an edit link. */
  lastSharedEdit: { at: string, ip: string } | null
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

/** Stored as { <locale>: [{ key, value }] } for the same reason as `values`: block ids and field keys are arbitrary. */
export function readTranslations(value: unknown): EmailTranslations {
  const out: EmailTranslations = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [tag, pairs] of Object.entries(value as Record<string, unknown>)) out[tag] = readValues(pairs)
  }
  return out
}

export function storeTranslations(row: ParseObject, translations: EmailTranslations): void {
  row.set('translations', Object.fromEntries(Object.entries(translations).map(([tag, strings]) => [tag, Object.entries(strings).map(([key, value]) => ({ key, value }))])))
}

function readVariables(value: unknown): TemplateVariable[] {
  return Array.isArray(value) ? value.filter(v => v && typeof v.key === 'string') : []
}

export function serializeEmailTemplate(row: ParseObject): EmailTemplate {
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
    locale: normalizeLocale(row.get('locale')) || DEFAULT_CONTENT_LOCALE,
    translations: readTranslations(row.get('translations')),
    shareMode: (row.get('shareMode') as ShareMode) || null,
    shareToken: (row.get('shareToken') as string) || null,
    shareExpiresAt: millis(row.get('shareExpiresAt')) || null,
    lastSharedEdit: (row.get('lastSharedEdit') as EmailTemplate['lastSharedEdit']) || null,
    lastActorId: (row.get('lastActorId') as string) || null,
    updatedAt: millis(row.updatedAt),
    // `include('master')` fetched it; a bare pointer has no name yet.
    master: master?.get('name') !== undefined
      ? { id: master.id || '', name: String(master.get('name') || ''), document: (master.get('document') as EmailDocument) || null, variables: readVariables(master.get('variables')), locale: normalizeLocale(master.get('locale')) || DEFAULT_CONTENT_LOCALE, translations: readTranslations(master.get('translations')), updatedAt: millis(master.updatedAt) }
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
 * `locale` (the language the design is written in) and `translations`: a language that is
 * present replaces that language's strings, `null` removes it. A linked row has neither:
 * it renders the master's.
 */
function applyEmailLanguages(row: ParseObject, input: Record<string, unknown>): void {
  const bad = (message: string): never => { throw createError({ statusCode: 400, statusMessage: message }) }
  if (input.locale !== undefined) row.set('locale', normalizeLocale(input.locale) || bad('locale must be a language tag such as "en" or "pt-BR"'))
  if (input.translations === undefined) return
  if (!input.translations || typeof input.translations !== 'object' || Array.isArray(input.translations)) bad('translations must be an object keyed by language')
  const source = normalizeLocale(row.get('locale')) || DEFAULT_CONTENT_LOCALE
  const next = readTranslations(row.get('translations'))
  for (const [rawTag, raw] of Object.entries(input.translations as Record<string, unknown>)) {
    const tag = normalizeLocale(rawTag) || bad(`"${rawTag.slice(0, 20)}" is not a language tag`)
    if (tag.toLowerCase() === source.toLowerCase()) bad(`${tag} is the template's own language`)
    if (raw === null) { delete next[tag]; continue }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad(`${tag}: pass an object of key → text`)
    next[tag] = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => [k.slice(0, 120), String(v)]))
  }
  if (Object.keys(next).length > EMAIL_MAX_TRANSLATIONS) bad(`A template has at most ${EMAIL_MAX_TRANSLATIONS} translations`)
  if (JSON.stringify(next).length > MAX_DOCUMENT_CHARS) throw createError({ statusCode: 413, statusMessage: 'The translations are too large' })
  storeTranslations(row, next)
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
    if (!linked) applyEmailLanguages(row, input)
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
  const doc = applyProjectAccent(master.get('document') as EmailDocument, brandAccentOf(brandOf(project)))
  row.set('document', doc)
  row.set('locale', master.get('locale') || DEFAULT_CONTENT_LOCALE)
  if (master.get('translations')) row.set('translations', master.get('translations'))
  row.set('variables', readVariables(master.get('variables')).map(v => (values[v.key] !== undefined ? { ...v, defaultValue: values[v.key] } : v)))
  row.set('values', [])
  row.unset('master')
}

// ---- rendering -------------------------------------------------------------

/** What a template sees of a project: its look (Brand kit), company profile and legal pages. Synchronous: everything is kept on the project row. */
export function brandOf(project: ParseObject): EmailBrand {
  const look = lookOf(project)
  const company = companyOf(project)
  return {
    name: look.name,
    brandLogoUrl: look.logoUrl,
    siteUrl: String(project.get('siteUrl') || ''),
    theme: { accent: look.accent },
    look: { accent: look.accent, logoUrl: look.logoUrl },
    address: company.address,
    company,
    legalLinks: legalLinksOf(project)
  }
}

/** The language an email goes out in: the first of `wanted` the template has (its own language otherwise). */
export function emailLocaleFor(source: { locale: string, translations: EmailTranslations }, wanted: unknown[]): string {
  return matchLocale(wanted, [source.locale, ...Object.keys(source.translations)]) || source.locale
}

/** Subject, HTML and text exactly as the send API delivers them, in the first of `wanted` the template has. */
export function renderEmailTemplate(row: ParseObject, project: ParseObject | null, values: Record<string, string> = {}, wanted: unknown[] = []) {
  const template = serializeEmailTemplate(row)
  if (template.masterId && !template.master) throw new Error('renderEmailTemplate needs the master included')
  // A linked row's words are the master's, so are its translations.
  const owner = template.master || template
  const locale = emailLocaleFor(owner, wanted)
  const words = locale === owner.locale ? null : owner.translations[locale] || null
  const localized = words && owner.document ? localizeEmail(owner.document, words) : null
  const { subject, document } = resolveTemplate(
    localized && !template.master ? { ...template, document: localized } : template,
    { master: localized && template.master ? { ...template.master, document: localized } : template.master, brand: project ? brandOf(project) : null, values }
  )
  const html = renderEmailHtml(document)
  return { subject, html, text: plainTextFor(document, html), locale }
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

const DAY_MS = 24 * 60 * 60 * 1000
/** An edit link can rewrite mail that is really sent, so it lives the shortest. */
export const SHARE_DEFAULT_DAYS: Record<ShareMode, number> = { view: 30, edit: 7 }
export const SHARE_MAX_DAYS = 90

// Keys the server looks up to send its own mail: the sign-up confirmation
// (signup.ts), CHANGELOG_CONFIRM_TEMPLATE and CHANGELOG_DIGEST_TEMPLATE.
// Spelled out: importing the changelog modules here would close an import
// cycle back through emailSend.
const SYSTEM_EMAIL_KEYS = new Set(['confirm-subscription', 'changelog-confirm', 'changelog'])

/** Why a template may only be shared view-only, or null when an edit link is fine. */
export function shareEditRefusal(template: Pick<EmailTemplate, 'projectId' | 'masterId' | 'key'>): string | null {
  if (template.masterId) return 'A linked master can only be shared view-only; edit the master instead'
  if (!template.projectId) return 'A master can only be shared view-only: an edit would change it for every project that uses it'
  if (SYSTEM_EMAIL_KEYS.has(template.key)) return `"${template.key}" is mail the server sends itself, so it can only be shared view-only`
  return null
}

/** When a link shared now expires: after `expiresInDays` (1 to 90) if given, else the mode's default. */
export function shareExpiresAt(mode: ShareMode, expiresInDays: unknown, now = Date.now()): Date {
  const days = expiresInDays ?? SHARE_DEFAULT_DAYS[mode]
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > SHARE_MAX_DAYS) {
    throw createError({ statusCode: 400, statusMessage: `expiresInDays must be a whole number from 1 to ${SHARE_MAX_DAYS}` })
  }
  return new Date(now + days * DAY_MS)
}

/**
 * Whether a share link still opens. A link shared before links expired has no
 * date and counts as expired, so none lives forever; sharing it again renews
 * the same URL.
 */
export function shareLinkActive(mode: unknown, expiresAt: unknown, now = Date.now()): boolean {
  return (mode === 'view' || mode === 'edit') && expiresAt instanceof Date && expiresAt.getTime() > now
}

/** What a share link sees of a template: the design, without the ids, values or master behind it. */
export type SharedEmailTemplate = Pick<EmailTemplate, 'name' | 'document' | 'variables' | 'lastActorId' | 'updatedAt'>

export function sharedEmailTemplate(template: EmailTemplate): SharedEmailTemplate {
  return { name: template.name, document: template.document, variables: template.variables, lastActorId: template.lastActorId, updatedAt: template.updatedAt }
}

/**
 * Resolve a share link. An expired link answers exactly like a revoked or
 * unknown one. The mode is what the link may do now: an edit link to a
 * template that has since become system mail only views.
 */
export async function findSharedEmail(event: H3Event, token: string, need: ShareMode): Promise<{ row: ParseObject, mode: ShareMode }> {
  await rateLimit(`sb:rl:emailshare:${clientIp(event) || 'ip'}`, LIMITS.emailSharePerIp.limit, LIMITS.emailSharePerIp.window)
  const row = token ? await new (useParse()).Query('EmailTemplate').equalTo('shareToken', token).include(['master', 'project']).first(MASTER) : null
  if (!row || !shareLinkActive(row.get('shareMode'), row.get('shareExpiresAt'))) throw createError({ statusCode: 404, statusMessage: 'This share link is no longer active' })
  const mode: ShareMode = row.get('shareMode') === 'edit' && !shareEditRefusal(serializeEmailTemplate(row)) ? 'edit' : 'view'
  if (need === 'edit' && mode !== 'edit') throw createError({ statusCode: 403, statusMessage: 'This link is view-only' })
  return { row, mode }
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

