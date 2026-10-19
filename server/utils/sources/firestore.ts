import { createSign } from 'node:crypto'
import { createError } from 'h3'
import { mappedColumns } from '#shared/contacts'
import type { SourceConfig, SourceCursor, SourceDriver } from '../contactSources'

// Cloud Firestore over its REST API, signed in as a service account (the JSON
// key from Firebase → Project settings → Service accounts). Documents are
// read with runQuery, only the mapped fields, ordered by an updated-at field
// and the document name; without one, a full scan by name that starts over.
// Documents that lack the order field are invisible to Firestore's ordering,
// so the full scan is the safe choice when not every document has it.

type ServiceAccount = { client_email: string, private_key: string, project_id: string }
type FirestoreValue = Record<string, any>

const COLLECTION_RE = /^[A-Za-z0-9_-]{1,100}$/
const tokens = new Map<string, { token: string, expires: number }>()

export function serviceAccountJwt(account: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const head = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  return `${head}.${createSign('RSA-SHA256').update(head).sign(account.private_key, 'base64url')}`
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const cached = tokens.get(account.client_email)
  if (cached && cached.expires > Date.now()) return cached.token
  let assertion: string
  try { assertion = serviceAccountJwt(account) } catch { throw createError({ statusCode: 400, statusMessage: 'The service account private key could not sign; paste the whole JSON key file' }) }
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(15_000) })
  const body = await res.json().catch(() => ({})) as { access_token?: string, expires_in?: number, error_description?: string }
  if (!res.ok || !body.access_token) throw createError({ statusCode: 502, statusMessage: `Google sign-in failed: ${body.error_description || res.status}` })
  tokens.set(account.client_email, { token: body.access_token, expires: Date.now() + Math.min(body.expires_in || 3600, 3300) * 1000 })
  return body.access_token
}

/** A Firestore Value as plain JSON. */
export function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if ('nullValue' in value) return null
  if ('referenceValue' in value) return value.referenceValue
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([k, v]) => [k, decodeFirestoreValue(v as FirestoreValue)]))
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map((v: FirestoreValue) => decodeFirestoreValue(v))
  return undefined
}

const fieldPath = (path: string) => path.split('.').map(p => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `\`${p.replace(/`/g, '\\`')}\``)).join('.')

export function firestoreQuery(config: SourceConfig, account: ServiceAccount, cursor: SourceCursor, limit: number) {
  const orderBy = [...(config.updatedField ? [{ field: { fieldPath: fieldPath(config.updatedField) }, direction: 'ASCENDING' }] : []), { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }]
  const fields = [...new Set([...mappedColumns(config.mapping), ...(config.updatedField ? [config.updatedField.split('.')[0]!] : [])])]
  const startAt = cursor.id
    ? { values: [...(config.updatedField ? [cursor.value as FirestoreValue] : []), { referenceValue: cursor.id }], before: false }
    : undefined
  return {
    structuredQuery: {
      from: [{ collectionId: config.collection }],
      select: { fields: [...fields.map(f => ({ fieldPath: fieldPath(f) })), { fieldPath: '__name__' }] },
      orderBy,
      ...(startAt ? { startAt } : {}),
      limit
    }
  }
}

async function runQuery(account: ServiceAccount, body: unknown): Promise<{ document?: { name: string, fields?: Record<string, FirestoreValue> } }[]> {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(account)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  })
  const json = await res.json().catch(() => null) as any
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: `Firestore answered ${res.status}: ${String(json?.[0]?.error?.message || json?.error?.message || res.statusText).slice(0, 200)}` })
  return Array.isArray(json) ? json : []
}

function plainDocument(doc: { name: string, fields?: Record<string, FirestoreValue> }): Record<string, unknown> {
  return { id: doc.name.split('/').pop(), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, decodeFirestoreValue(v)])) }
}

const SECRETISH = /pass|hash|secret|token|salt|otp|key/i

/** The raw Value at a dot-path, as Firestore needs it back in a cursor. */
export function valueAt(fields: Record<string, FirestoreValue> | undefined, path: string): FirestoreValue {
  let value: FirestoreValue | undefined = { mapValue: { fields } }
  for (const part of path.split('.')) value = value?.mapValue?.fields?.[part]
  return value ?? { nullValue: null }
}

export const firestoreDriver: SourceDriver<ServiceAccount> = {
  label: 'Firebase / Firestore',
  validate(config) {
    const errors: string[] = []
    if (!COLLECTION_RE.test(String(config.collection || ''))) errors.push('collection must be a top-level collection id, such as users')
    if (config.updatedField && !/^[\w$-]+(\.[\w$-]+)*$/.test(config.updatedField)) errors.push('updatedField must be a field path')
    return errors
  },
  readSecret(value) {
    let account: any = value
    if (typeof value === 'string') { try { account = JSON.parse(value) } catch { account = null } }
    if (!account?.client_email || !account?.private_key || !account?.project_id) throw createError({ statusCode: 400, statusMessage: 'Paste the service account JSON key (it has client_email, private_key and project_id)' })
    return { client_email: String(account.client_email), private_key: String(account.private_key), project_id: String(account.project_id) }
  },
  async test(config, account) {
    const docs = (await runQuery(account, { structuredQuery: { from: [{ collectionId: config.collection }], limit: 3 } })).filter(r => r.document)
    const sample = docs.map(r => plainDocument(r.document!))
    const fields = [...new Set(sample.flatMap(r => Object.keys(r)))]
    return { fields, sample: sample.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRETISH.test(k)))), idType: '' }
  },
  async page(config, account, cursor, limit) {
    const docs = (await runQuery(account, firestoreQuery(config, account, cursor, limit))).filter(r => r.document)
    const rows = docs.map(r => plainDocument(r.document!))
    const last = docs.at(-1)?.document
    const next = last ? { id: last.name, ...(config.updatedField ? { value: valueAt(last.fields, config.updatedField) } : {}) } : cursor
    return { rows, next, done: docs.length < limit }
  }
}
