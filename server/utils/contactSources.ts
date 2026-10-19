import { createError } from 'h3'
import { mapSourceRow, validateMapping, type ContactFieldMapping, type ContactInput } from '#shared/contacts'
import { upsertContacts } from './contacts'
import { MASTER, iso, pointerId, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { readCredential, storeCredential } from './secrets'
import { workspaceIsActive } from './tenancy'
import { hasFeature, projectWorkspaceId } from './usage'
import { firestoreDriver } from './sources/firestore'
import { parseDriver } from './sources/parse'
import { postgresDriver } from './sources/postgres'

// Contact sources: the developer's own database, read on a schedule and
// merged into the project's contacts (one way — HelpBites never writes back;
// changes it owns go out as webhooks). Each kind is a driver with the same
// shape, like the error trackers in errorTracking.ts. The sync state — the
// cursor, the last run, the counts — lives on the ContactSource row, so a
// crash or a deploy resumes where it stopped.

export type SourceKind = 'parse' | 'postgres' | 'firestore'

export type SourceConfig = {
  // Parse
  serverUrl?: string
  appId?: string
  className?: string
  // Postgres
  table?: string
  idField?: string
  idType?: string
  // Firestore
  collection?: string
  // Any: the column that changes when a row changes. Without one, every run is a full scan.
  updatedField?: string
  mapping: ContactFieldMapping
  /** 'subscribed': the operator says everyone in this source opted in to marketing. */
  consent: 'keep' | 'subscribed'
  /** Minutes between runs; 0 runs only on demand. */
  everyMinutes: number
}

/** Where the last run stopped. `value` is Firestore's raw order value. */
export type SourceCursor = { updated?: string, id?: string, value?: unknown }
export type SourcePage = { rows: Record<string, unknown>[], next: SourceCursor, done: boolean }

export type SourceDriver<Secret> = {
  label: string
  validate: (config: SourceConfig) => string[]
  readSecret: (value: unknown) => Secret
  test: (config: SourceConfig, secret: Secret) => Promise<{ fields: string[], sample: Record<string, unknown>[], idType: string }>
  page: (config: SourceConfig, secret: Secret, cursor: SourceCursor, limit: number) => Promise<SourcePage>
}

const DRIVERS: Record<SourceKind, SourceDriver<any>> = { parse: parseDriver, postgres: postgresDriver, firestore: firestoreDriver }
export const SOURCE_KINDS = Object.keys(DRIVERS) as SourceKind[]
export const SYNC_INTERVALS = [0, 15, 60, 360, 1440]

const PAGE_SIZE = 500
// One run per worker tick does this much, then the next tick continues.
const RUN_BUDGET_MS = 25_000

export function sourceDriver(kind: unknown): SourceDriver<any> {
  const driver = DRIVERS[kind as SourceKind]
  if (!driver) throw createError({ statusCode: 400, statusMessage: `kind must be one of ${SOURCE_KINDS.join(', ')}` })
  return driver
}

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** A config as the panel sends it, checked for its kind. Parse's id and updated fields are fixed. */
export function readSourceConfig(kind: SourceKind, value: unknown, base?: SourceConfig): SourceConfig {
  const raw = { ...(base || {}), ...(value && typeof value === 'object' ? value as Record<string, unknown> : {}) } as Record<string, unknown>
  const { mapping, errors } = validateMapping(raw.mapping)
  const every = Number(raw.everyMinutes ?? 60)
  const config: SourceConfig = {
    serverUrl: text(raw.serverUrl, 500).replace(/\/+$/, '') || undefined,
    appId: text(raw.appId) || undefined,
    className: text(raw.className) || undefined,
    table: text(raw.table) || undefined,
    idField: kind === 'parse' ? 'objectId' : kind === 'firestore' ? 'id' : text(raw.idField) || undefined,
    idType: text(raw.idType, 60) || undefined,
    collection: text(raw.collection) || undefined,
    updatedField: kind === 'parse' ? 'updatedAt' : text(raw.updatedField) || undefined,
    mapping,
    consent: raw.consent === 'subscribed' ? 'subscribed' : 'keep',
    everyMinutes: SYNC_INTERVALS.includes(every) ? every : 60
  }
  errors.push(...sourceDriver(kind).validate(config))
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  return config
}

export type ContactSourceDto = {
  id: string
  projectId: string
  kind: SourceKind
  name: string
  config: SourceConfig
  hasSecret: boolean
  enabled: boolean
  status: 'idle' | 'running' | 'error'
  lastRunAt: string | null
  nextRunAt: string | null
  lastError: string
  /** How far the sync got: the last row's updated value or id. */
  position: string
  stats: { seen: number, created: number, updated: number, unchanged: number, failed: number, skipped: number, lastFullScanAt?: string }
  createdAt: string | null
}

export function serializeContactSource(row: ParseObject): ContactSourceDto {
  const cursor = (row.get('cursor') || {}) as SourceCursor
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    kind: row.get('kind'),
    name: String(row.get('name') || ''),
    config: row.get('config') as SourceConfig,
    hasSecret: Boolean(row.get('secretSealed')),
    enabled: row.get('enabled') !== false,
    status: row.get('status') || 'idle',
    lastRunAt: iso(row.get('lastRunAt')),
    nextRunAt: iso(row.get('nextRunAt')),
    lastError: String(row.get('lastError') || ''),
    position: cursor.updated || cursor.id || '',
    stats: { seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0, ...(row.get('stats') || {}) },
    createdAt: iso(row.createdAt)
  }
}

export async function getProjectSource(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await new (useParse()).Query('ContactSource').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Source not found' })
  return row
}

export function sealSourceSecret(kind: SourceKind, value: unknown): string {
  return storeCredential(JSON.stringify(sourceDriver(kind).readSecret(value)))
}

export function sourceSecret(row: ParseObject): unknown {
  return JSON.parse(readCredential(String(row.get('secretSealed') || '')))
}

/** Rows of a page as contacts, with the source's consent rule applied. */
export function sourceInputs(config: SourceConfig, rows: Record<string, unknown>[]): { inputs: ContactInput[], skipped: number } {
  const inputs: ContactInput[] = []
  let skipped = 0
  for (const row of rows) {
    const input = mapSourceRow(row, config.mapping)
    if (!input) { skipped++; continue }
    if (config.consent === 'subscribed' && !config.mapping.subscribed) input.subscription = 'subscribed'
    inputs.push(input)
  }
  return { inputs, skipped }
}

/**
 * Run one source for up to RUN_BUDGET_MS: pages from the cursor, merges each
 * into contacts, saves the cursor after every page. Done with an incremental
 * source means caught up; done with a full scan means it starts over next run.
 */
export async function runSourceSync(sourceId: string, options: { reset?: boolean, budgetMs?: number } = {}): Promise<{ ran: boolean }> {
  const result = await runExclusive(`sb:sync:${sourceId}`, 120, async () => {
    const Parse = useParse()
    const row = await new Parse.Query('ContactSource').include('project').get(sourceId, MASTER)
    const project = row.get('project') as ParseObject
    const kind = row.get('kind') as SourceKind
    const config = row.get('config') as SourceConfig
    const workspaceId = await projectWorkspaceId(project)
    if (!(await workspaceIsActive(workspaceId)) || !(await hasFeature(workspaceId, 'contactSources'))) {
      // Suspended, or not on the workspace's plan: look again in an hour, so an upgrade picks it up without these sources crowding out the rest.
      row.set('nextRunAt', new Date(Date.now() + 60 * 60_000))
      await row.save(null, MASTER)
      return
    }
    const driver = sourceDriver(kind)
    const stats = { seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0, ...(options.reset ? {} : row.get('stats') || {}) }
    let cursor: SourceCursor = options.reset ? {} : (row.get('cursor') || {})
    const deadline = Date.now() + (options.budgetMs ?? RUN_BUDGET_MS)
    row.set('status', 'running')
    await row.save(null, MASTER)

    try {
      const secret = driver.readSecret(sourceSecret(row))
      let done = false
      while (!done && Date.now() < deadline) {
        const page = await driver.page(config, secret, cursor, PAGE_SIZE)
        const { inputs, skipped } = sourceInputs(config, page.rows)
        const results = inputs.length ? await upsertContacts(project, inputs, { via: 'sync', sourceId }) : []
        stats.seen += page.rows.length
        stats.skipped += skipped
        for (const r of results) stats[r.status]++
        done = page.done
        if (done && !config.updatedField) {
          // A full scan reached the end: the next run starts over.
          cursor = {}
          Object.assign(stats, { lastFullScanAt: new Date().toISOString() })
        } else cursor = page.next
        row.set('cursor', cursor)
        row.set('stats', stats)
        await row.save(null, MASTER)
      }
      row.set('status', 'idle')
      row.set('lastError', '')
      row.set('lastRunAt', new Date())
      const every = Number(config.everyMinutes) || 0
      // Not done yet: the next tick continues. Done: wait for the schedule (or a manual run).
      if (!done) row.set('nextRunAt', new Date())
      else if (every) row.set('nextRunAt', new Date(Date.now() + every * 60_000))
      else row.unset('nextRunAt')
    } catch (error) {
      row.set('status', 'error')
      row.set('lastError', String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Sync failed').slice(0, 500))
      row.set('lastRunAt', new Date())
      // Back off: the database may be down for a while.
      row.set('nextRunAt', new Date(Date.now() + Math.max(15, Number(config.everyMinutes) || 60) * 60_000))
      console.warn(`[sources] ${sourceId} failed:`, row.get('lastError'))
    }
    await row.save(null, MASTER)
  })
  return { ran: result.ran }
}

/** Sources whose turn it is, oldest first. */
export async function dueSources(limit = 5): Promise<string[]> {
  const rows = await new (useParse()).Query('ContactSource').notEqualTo('enabled', false).lessThanOrEqualTo('nextRunAt', new Date()).ascending('nextRunAt').limit(limit).select('objectId').find(MASTER)
  return rows.map(r => r.id || '')
}
