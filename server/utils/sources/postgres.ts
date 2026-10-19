import { isIP } from 'node:net'
import type { SQL } from 'bun'
import { createError } from 'h3'
import { mappedColumns } from '#shared/contacts'
import { assertReachableHost } from '../outbound'
import type { SourceConfig, SourceCursor, SourceDriver } from '../contactSources'

// Postgres, Supabase included (use its connection string; the pooler on 6543
// needs prepared statements off, which is how this connects anyway). Read
// only: every query runs in a READ ONLY transaction with a statement timeout,
// selects only the mapped columns, and names tables and columns that passed
// IDENT_RE, so nothing typed into the form becomes SQL.
//
// Incremental with an updated-at column — (updated, id) > cursor — or a full
// scan by id that starts over when it reaches the end.

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
const TYPE_RE = /^[a-z][a-z0-9 _]{0,40}$/

type PostgresSecret = { url: string }

const quote = (ident: string) => `"${ident}"`
export function quoteTable(table: string): string {
  return table.split('.').map(quote).join('.')
}

export function validIdent(value: unknown): boolean {
  return typeof value === 'string' && IDENT_RE.test(value)
}

/** The page query, built from validated identifiers only; values are parameters. */
export function postgresPageQuery(config: SourceConfig, cursor: SourceCursor, limit: number): { text: string, params: unknown[] } {
  // Compared in its own type so the index on it is used; an exotic type (an enum, an array) as text.
  const typed = TYPE_RE.test(String(config.idType || ''))
  const id = typed ? quote(config.idField!) : `${quote(config.idField!)}::text`
  const idType = typed ? config.idType : 'text'
  const columns = [...new Set(mappedColumns(config.mapping))].filter(c => validIdent(c) && c !== config.idField && c !== config.updatedField)
  const select = [`${quote(config.idField!)}::text AS "__id"`, ...(config.updatedField ? [`${quote(config.updatedField)}::text AS "__updated"`] : []), ...columns.map(quote)].join(', ')
  const from = quoteTable(config.table!)
  if (config.updatedField) {
    const updated = quote(config.updatedField)
    const where = cursor.updated ? `WHERE (${updated}, ${id}) > ($1::timestamptz, $2::${idType}) ` : ''
    return { text: `SELECT ${select} FROM ${from} ${where}ORDER BY ${updated}, ${id} LIMIT ${Number(limit)}`, params: cursor.updated ? [cursor.updated, cursor.id] : [] }
  }
  const where = cursor.id ? `WHERE ${id} > $1::${idType} ` : ''
  return { text: `SELECT ${select} FROM ${from} ${where}ORDER BY ${id} LIMIT ${Number(limit)}`, params: cursor.id ? [cursor.id] : [] }
}

/**
 * The connection string pointed at the checked address, so the driver never
 * resolves the name again. When Bun's own reading of the string (sslmode,
 * ssl, PGSSLMODE) turns TLS on, its tls options still carry the host name,
 * which goes out as SNI and is what verify-full checks the certificate against.
 */
export async function pinnedPostgres(url: string, address: string): Promise<{ url: string, tls?: SQL.PostgresOrMySQLOptions['tls'] }> {
  // Loaded on use: the build prerenders under Node, which has no 'bun' module.
  const { SQL: Client } = await import('bun')
  const pinned = new URL(url)
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address
  // Parsing only: a client opens no connection before its first query.
  const { tls } = new Client(url).options
  return { url: pinned.toString(), ...(tls ? { tls } : {}) }
}

async function withClient<T>(secret: PostgresSecret, fn: (sql: SQL) => Promise<T>): Promise<T> {
  let host = ''
  try { host = new URL(secret.url).hostname } catch { throw createError({ statusCode: 400, statusMessage: 'The connection string must look like postgres://user:password@host:5432/db' }) }
  const [address] = await assertReachableHost(host)
  const { SQL: Client } = await import('bun')
  const pinned = await pinnedPostgres(secret.url, address!)
  const sql = new Client(pinned.url, { max: 1, prepare: false, idleTimeout: 5, connectionTimeout: 10, ...(pinned.tls ? { tls: pinned.tls } : {}) })
  try {
    return await sql.begin('read only', async (tx) => {
      await tx.unsafe("SET LOCAL statement_timeout = '15s'")
      return fn(tx as unknown as SQL)
    })
  } catch (error) {
    const message = (error as Error).message || 'Query failed'
    throw createError({ statusCode: 502, statusMessage: `Postgres: ${message.replace(secret.url, '…').replace(pinned.url, '…').slice(0, 300)}` })
  } finally {
    await sql.close({ timeout: 1 }).catch(() => {})
  }
}

const SECRETISH = /pass|hash|secret|token|salt|otp|key/i

export const postgresDriver: SourceDriver<PostgresSecret> = {
  label: 'Postgres / Supabase',
  validate(config) {
    const errors: string[] = []
    const parts = String(config.table || '').split('.')
    if (!parts.length || parts.length > 2 || !parts.every(validIdent)) errors.push('table must be a table or view, such as users or public.users')
    if (!validIdent(config.idField)) errors.push('idField must be a column name')
    if (config.updatedField && !validIdent(config.updatedField)) errors.push('updatedField must be a column name')
    return errors
  },
  readSecret(value) {
    const url = String((value as any)?.url || '').trim()
    if (!/^postgres(ql)?:\/\//.test(url)) throw createError({ statusCode: 400, statusMessage: 'The connection string must start with postgres://' })
    return { url }
  },
  async test(config, secret) {
    return withClient(secret, async (sql) => {
      const [schema, table] = config.table!.includes('.') ? config.table!.split('.') : ['', config.table!]
      const columns = await sql.unsafe(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ${schema ? 'AND table_schema = $2' : 'AND table_schema = ANY (current_schemas(false))'} ORDER BY ordinal_position`,
        schema ? [table, schema] : [table]
      ) as { column_name: string, data_type: string }[]
      if (!columns.length) throw createError({ statusCode: 400, statusMessage: `No table or view named ${config.table} that this user can read` })
      const safe = columns.map(c => c.column_name).filter(c => !SECRETISH.test(c) && validIdent(c))
      const sample = safe.length ? await sql.unsafe(`SELECT ${safe.map(quote).join(', ')} FROM ${quoteTable(config.table!)} LIMIT 3`) as Record<string, unknown>[] : []
      const idColumn = columns.find(c => c.column_name === config.idField)
      if (config.idField && !idColumn) throw createError({ statusCode: 400, statusMessage: `${config.table} has no column ${config.idField}` })
      if (config.updatedField && !columns.some(c => c.column_name === config.updatedField)) throw createError({ statusCode: 400, statusMessage: `${config.table} has no column ${config.updatedField}` })
      return { fields: columns.map(c => c.column_name), sample: [...sample], idType: idColumn?.data_type || 'text' }
    })
  },
  async page(config, secret, cursor, limit) {
    const { text, params } = postgresPageQuery(config, cursor, limit)
    const rows = await withClient(secret, sql => sql.unsafe(text, params)) as Record<string, unknown>[]
    const plain = [...rows].map(r => ({ ...r, [config.idField!]: r.__id, ...(config.updatedField ? { [config.updatedField]: r.__updated } : {}) }))
    const last = plain.at(-1) as Record<string, unknown> | undefined
    const next = last ? { id: String(last.__id), ...(config.updatedField ? { updated: String(last.__updated) } : {}) } : cursor
    return { rows: plain, next, done: plain.length < limit }
  }
}
