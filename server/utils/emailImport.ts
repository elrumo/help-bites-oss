import { createError } from 'h3'
import type { EmailDocument } from '#shared/email/blocks'
import { htmlToEmailDocument } from '#shared/email/import'
import { validateDocument } from './emails'

// Templates in and out as JSON: a whole project (or the masters) exported in
// one file, and brought into this or another HelpBites with an upsert by send
// key. A migration script is one client; a backup is another.

export type EmailImportItem = {
  key: string
  name?: string
  description?: string
  /** A folder path such as `Account/Security`; created when missing. */
  folder?: string
  /** The design. Or `html` (one custom-HTML block) with optional subject / preheader / text / settings. */
  document?: unknown
  html?: string
  subject?: string
  preheader?: string
  text?: string
  settings?: Record<string, unknown>
  variables?: { key: string, label?: string, defaultValue?: string }[]
  /** Link a master (its id or exact name, or `{ id, name }`) instead of carrying a design. */
  master?: string | { id?: string, name?: string }
  variableValues?: Record<string, string>
}

export type EmailImportAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'
export type EmailImportResult = { key: string, action: EmailImportAction, id: string | null, name: string, error?: string }

export const MAX_IMPORT_ITEMS = 100
/** One imported email's HTML: an email past this is not an email, and reading it is work for the whole server. */
export const MAX_IMPORT_HTML = 2_000_000

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort().map(k => [k, stable((value as Record<string, unknown>)[k])]))
  return value
}

const same = (a: unknown, b: unknown) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null))

/** The design an item describes, or null when it links a master. */
export function importItemDocument(item: EmailImportItem): EmailDocument | null {
  if (item.master) return null
  let doc: EmailDocument
  if (item.document !== undefined && item.document !== null) {
    doc = validateDocument(item.document)
    if (item.subject) doc = { ...doc, settings: { ...doc.settings, title: item.subject } }
    if (item.preheader !== undefined) doc = { ...doc, settings: { ...doc.settings, preheader: item.preheader } }
    if (item.text !== undefined) doc = { ...doc, settings: { ...doc.settings, text: item.text } }
  } else if (typeof item.html === 'string' && item.html.trim()) {
    if (item.html.length > MAX_IMPORT_HTML) throw createError({ statusCode: 400, statusMessage: `html is up to ${MAX_IMPORT_HTML.toLocaleString('en-US')} characters` })
    doc = validateDocument(htmlToEmailDocument(item.html, { title: item.subject, preheader: item.preheader, text: item.text, settings: item.settings as Partial<EmailDocument['settings']> }))
  } else {
    throw createError({ statusCode: 400, statusMessage: 'needs a document, html or master' })
  }
  return doc
}

type FolderIndex = { byPath: Map<string, ParseObject>, pathOf: Map<string, string> }

async function loadFolders(project: ParseObject | null, workspace: ParseObject): Promise<FolderIndex> {
  const query = new (useParse()).Query('EmailFolder').equalTo('workspace', workspace).limit(1000)
  if (project) query.equalTo('project', project)
  else query.doesNotExist('project')
  const rows = await query.find(MASTER)
  const byId = new Map(rows.map(r => [r.id || '', r]))
  const pathOf = new Map<string, string>()
  const resolve = (row: ParseObject, depth = 0): string => {
    const cached = pathOf.get(row.id || '')
    if (cached !== undefined) return cached
    const parent = byId.get(pointerId(row.get('parent')))
    const path = parent && depth < 10 ? `${resolve(parent, depth + 1)}/${row.get('name')}` : String(row.get('name') || '')
    pathOf.set(row.id || '', path)
    return path
  }
  const byPath = new Map<string, ParseObject>()
  for (const row of rows) byPath.set(resolve(row).toLowerCase(), row)
  return { byPath, pathOf }
}

function folderSegments(path: string): string[] {
  return path.split('/').map(s => s.trim().slice(0, 80)).filter(Boolean).slice(0, 5)
}

/** The folder at `path`, created level by level when `create` (else null for a missing one). */
async function folderAt(project: ParseObject | null, workspace: ParseObject, path: string, index: FolderIndex, create: boolean): Promise<ParseObject | null> {
  let parent: ParseObject | null = null
  const walked: string[] = []
  for (const segment of folderSegments(path)) {
    walked.push(segment)
    const key = walked.join('/').toLowerCase()
    let folder = index.byPath.get(key) || null
    if (!folder) {
      if (!create) return null
      folder = new (useParse().Object.extend('EmailFolder'))() as ParseObject
      folder.set('name', segment)
      folder.set('workspace', workspace)
      if (project) folder.set('project', project)
      if (parent) folder.set('parent', parent)
      await folder.save(null, MASTER)
      index.byPath.set(key, folder)
      index.pathOf.set(folder.id || '', walked.join('/'))
    }
    parent = folder
  }
  return parent
}

async function findMaster(ref: EmailImportItem['master'], workspace: ParseObject): Promise<ParseObject> {
  const Parse = useParse()
  const id = typeof ref === 'object' ? ref?.id : ref
  const name = typeof ref === 'object' ? ref?.name : ref
  const masters = () => new Parse.Query('EmailTemplate').equalTo('workspace', workspace).doesNotExist('project').doesNotExist('master')
  const master = (id ? await masters().equalTo('objectId', String(id)).first(MASTER) : null)
    || (name ? await masters().equalTo('name', String(name)).first(MASTER) : null)
  if (!master) throw createError({ statusCode: 400, statusMessage: `no master "${String(name || id || '').slice(0, 80)}"` })
  return master
}

/**
 * Upsert by send key. `create` leaves existing templates alone; `upsert`
 * updates them. A dry run reports what would happen and writes nothing.
 * Items fail one at a time: one bad item never stops the rest.
 */
export async function importEmailTemplates(project: ParseObject | null, workspace: ParseObject, items: EmailImportItem[], options: { mode: 'create' | 'upsert', dryRun: boolean }): Promise<EmailImportResult[]> {
  const Parse = useParse()
  const folders = await loadFolders(project, workspace)
  const results: EmailImportResult[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const key = slugKey(item?.key)
    const result: EmailImportResult = { key: key || String(item?.key ?? ''), action: 'failed', id: null, name: String(item?.name || '') }
    results.push(result)
    try {
      if (!key) throw createError({ statusCode: 400, statusMessage: 'needs a key' })
      if (seen.has(key)) throw createError({ statusCode: 400, statusMessage: 'appears twice in this import' })
      seen.add(key)

      const query = new Parse.Query('EmailTemplate').equalTo('workspace', workspace).equalTo('key', key).include('master')
      if (project) query.equalTo('project', project)
      else query.doesNotExist('project')
      const existing = await query.first(MASTER)
      result.id = existing?.id || null

      if (existing && options.mode === 'create') {
        result.action = 'skipped'
        result.name = String(existing.get('name') || '')
        result.error = 'already exists (pass mode: "upsert" to update it)'
        continue
      }

      const document = importItemDocument(item)
      const master = item.master ? await findMaster(item.master, workspace) : null
      if (master && !project) throw createError({ statusCode: 400, statusMessage: 'a master can only be linked into a project' })
      if (existing && master && !existing.get('master')) throw createError({ statusCode: 400, statusMessage: 'has its own design; delete it before linking a master under this key' })
      if (existing && document && existing.get('master')) throw createError({ statusCode: 400, statusMessage: 'is linked to a master; detach it before importing a design' })

      const name = String(item.name || master?.get('name') || document?.settings.title || key).trim().slice(0, 120)
      result.name = name
      const description = item.description !== undefined ? String(item.description || '').trim().slice(0, 500) : existing ? String(existing.get('description') || '') : ''
      const variables = document ? reconcileVariables(document, item.variables ?? existing?.get('variables') ?? []) : null
      const values = master ? cleanVariableValues(item.variableValues) : null
      const folderPath = item.folder !== undefined ? folderSegments(String(item.folder || '')).join('/') : null
      const folder = folderPath ? await folderAt(project, workspace, folderPath, folders, !options.dryRun) : null

      if (existing) {
        const currentFolder = folders.pathOf.get(pointerId(existing.get('folder'))) || ''
        const unchanged = existing.get('name') === name
          && String(existing.get('description') || '') === description
          && (folderPath === null || currentFolder.toLowerCase() === folderPath.toLowerCase())
          && (document ? same(existing.get('document'), document) && same(existing.get('variables'), variables) : true)
          && (master ? pointerId(existing.get('master')) === master.id && same(existing.get('values') || [], Object.entries(values || {}).map(([k, value]) => ({ key: k, value }))) : true)
        if (unchanged) {
          result.action = 'unchanged'
          continue
        }
      }

      result.action = existing ? 'updated' : 'created'
      if (options.dryRun) continue

      const row = existing || new (Parse.Object.extend('EmailTemplate'))()
      if (!existing) {
        row.set('workspace', workspace)
        if (project) row.set('project', project)
        row.set('key', key)
      }
      row.set('name', name)
      row.set('description', description)
      if (folderPath !== null) {
        if (folder) row.set('folder', folder)
        else row.unset('folder')
      }
      if (document) {
        row.set('document', document)
        row.set('variables', variables)
      } else if (master) {
        row.set('master', master)
        storeValues(row, values || {})
      }
      row.set('lastActorId', 'import')
      if (existing) await saveAndBroadcast(row)
      else await row.save(null, MASTER)
      result.id = row.id || null
    } catch (error) {
      result.action = 'failed'
      result.error = (error as { statusMessage?: string }).statusMessage || (error as Error).message || 'failed'
    }
  }
  return results
}

export type EmailExportItem = EmailImportItem & { id: string }

/** Everything `importEmailTemplates` needs to recreate these templates elsewhere. */
export async function exportEmailTemplates(project: ParseObject | null, workspace: ParseObject): Promise<EmailExportItem[]> {
  const query = new (useParse()).Query('EmailTemplate').equalTo('workspace', workspace).include('master').ascending('key').limit(1000)
  if (project) query.equalTo('project', project)
  else query.doesNotExist('project')
  const [rows, folders] = await Promise.all([query.find(MASTER), loadFolders(project, workspace)])
  return rows.map((row) => {
    const t = serializeEmailTemplate(row)
    const base = { id: t.id, key: t.key, name: t.name, description: t.description, folder: folders.pathOf.get(t.folderId || '') || '' }
    return t.masterId
      ? { ...base, master: { id: t.masterId, name: t.master?.name || '' }, variableValues: t.variableValues }
      : { ...base, document: t.document, variables: t.variables }
  })
}
