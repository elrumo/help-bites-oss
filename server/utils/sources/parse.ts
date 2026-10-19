import { createError } from 'h3'
import { mappedColumns } from '#shared/contacts'
import { safeFetch } from '../outbound'
import type { SourceConfig, SourceCursor, SourceDriver } from '../contactSources'

// A developer's own Parse Server, read over REST with its master key (the
// JS SDK is a singleton already bound to HelpBites' own Parse). Every Parse
// class has objectId and updatedAt, so this is always incremental:
// updatedAt > cursor, ties broken by objectId.

const CLASS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

type ParseSecret = { masterKey: string }

function base(config: SourceConfig): string {
  return String(config.serverUrl || '').replace(/\/+$/, '')
}

async function call(config: SourceConfig, secret: ParseSecret, path: string): Promise<any> {
  const res = await safeFetch(`${base(config)}${path}`, { headers: { 'X-Parse-Application-Id': String(config.appId || ''), 'X-Parse-Master-Key': secret.masterKey } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: `Parse answered ${res.status}: ${String(body?.error || res.statusText).slice(0, 200)}` })
  return body
}

/** The `where` that continues after the cursor. */
export function parseWhere(cursor: SourceCursor): Record<string, unknown> {
  if (!cursor.updated) return {}
  const at = { __type: 'Date', iso: cursor.updated }
  return { $or: [{ updatedAt: { $gt: at } }, { updatedAt: at, objectId: { $gt: cursor.id || '' } }] }
}

export function parseQueryString(config: SourceConfig, cursor: SourceCursor, limit: number): string {
  const keys = [...new Set(['objectId', 'updatedAt', ...mappedColumns(config.mapping)])]
  const params = new URLSearchParams({ where: JSON.stringify(parseWhere(cursor)), order: 'updatedAt,objectId', limit: String(limit), keys: keys.join(',') })
  return `/classes/${config.className}?${params}`
}

export const parseDriver: SourceDriver<ParseSecret> = {
  label: 'Parse Server',
  validate(config) {
    const errors: string[] = []
    try { if (!/^https?:$/.test(new URL(base(config)).protocol)) throw new Error('') } catch { errors.push('serverUrl must be your Parse server URL, such as https://api.example.com/parse') }
    if (!config.appId) errors.push('appId is required')
    if (!CLASS_RE.test(String(config.className || ''))) errors.push('className must be a Parse class, such as _User')
    return errors
  },
  readSecret(value) {
    const masterKey = String((value as any)?.masterKey || '').trim()
    if (!masterKey) throw createError({ statusCode: 400, statusMessage: 'The master key is required' })
    return { masterKey }
  },
  async test(config, secret) {
    const [schema, sample] = await Promise.all([
      call(config, secret, `/schemas/${config.className}`),
      call(config, secret, `/classes/${config.className}?limit=3&order=-updatedAt`)
    ])
    return { fields: Object.keys(schema?.fields || {}).filter(f => f !== 'ACL'), sample: sample?.results || [], idType: '' }
  },
  async page(config, secret, cursor, limit) {
    const body = await call(config, secret, parseQueryString(config, cursor, limit))
    const rows = (body?.results || []) as Record<string, any>[]
    const last = rows.at(-1)
    return { rows, next: last ? { updated: String(last.updatedAt), id: String(last.objectId) } : cursor, done: rows.length < limit }
  }
}
