import { createHash, randomBytes } from 'node:crypto'
import { createError } from 'h3'

export type AdminApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string | null
  /** Null for a key made to never expire. */
  expiresAt: string | null
  lastUsedAt: string | null
  /** The only projects the key may act in; null = every project, and the workspace itself. */
  projectIds: string[] | null
}

/** Days a key lives when its creator does not say. */
export const DEFAULT_KEY_DAYS = 90
const MAX_KEY_DAYS = 365
// Writing on every request would make each key call a save; an hour is close enough.
const LAST_USED_GRANULARITY_MS = 60 * 60 * 1000

export function newAdminApiKey(): { token: string, hash: string, prefix: string } {
  const token = `ak_${randomBytes(32).toString('hex')}`
  return { token, hash: hashAdminApiKey(token), prefix: token.slice(0, 11) }
}

export function hashAdminApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * When a new key expires: `expiresInDays` from the request (1-365), the
 * default when it is left out, or never when it is explicitly null.
 */
export function readKeyExpiry(value: unknown, now = new Date()): Date | null {
  if (value === null) return null
  const days = value === undefined || value === '' ? DEFAULT_KEY_DAYS : Number(value)
  if (!Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS) {
    throw createError({ statusCode: 400, statusMessage: `expiresInDays must be a whole number from 1 to ${MAX_KEY_DAYS}, or null for a key that never expires` })
  }
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

export function adminApiKeyExpired(row: ParseObject, now = Date.now()): boolean {
  const expiresAt = row.get('expiresAt')
  return expiresAt instanceof Date && expiresAt.getTime() <= now
}

/** Stamp when a key was last used, at most hourly, without holding up the request. */
export function noteAdminApiKeyUse(row: ParseObject, now = Date.now()): void {
  const last = row.get('lastUsedAt')
  if (last instanceof Date && now - last.getTime() < LAST_USED_GRANULARITY_MS) return
  row.set('lastUsedAt', new Date(now))
  void row.save(null, MASTER).catch(() => {})
}

/** Revoke every key an operator owns, in every workspace: a key would otherwise outlive a takeover. */
export async function revokeAgentApiKeys(agentId: string): Promise<number> {
  const Parse = useParse()
  const rows = await new Parse.Query('AdminApiKey').equalTo('agent', Parse.User.createWithoutData(agentId)).find(MASTER)
  await Parse.Object.destroyAll(rows, MASTER)
  return rows.length
}

export function serializeAdminApiKey(row: ParseObject): AdminApiKey {
  return {
    id: row.id || '',
    name: String(row.get('name') || ''),
    prefix: String(row.get('prefix') || ''),
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.get('expiresAt')),
    lastUsedAt: iso(row.get('lastUsedAt')),
    projectIds: keyProjectIds(row)
  }
}

/** A key's project limit as stored: absent = unlimited. An empty list can't be created, but would limit to nothing. */
export function keyProjectIds(row: ParseObject): string[] | null {
  const ids = row.get('projectIds')
  return Array.isArray(ids) ? ids.map(String) : null
}
