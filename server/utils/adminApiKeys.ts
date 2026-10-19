import { createHash, randomBytes } from 'node:crypto'

export type AdminApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string | null
  /** The only projects the key may act in; null = every project, and the workspace itself. */
  projectIds: string[] | null
}

export function newAdminApiKey(): { token: string, hash: string, prefix: string } {
  const token = `ak_${randomBytes(32).toString('hex')}`
  return { token, hash: hashAdminApiKey(token), prefix: token.slice(0, 11) }
}

export function hashAdminApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function serializeAdminApiKey(row: ParseObject): AdminApiKey {
  return {
    id: row.id || '',
    name: String(row.get('name') || ''),
    prefix: String(row.get('prefix') || ''),
    createdAt: iso(row.createdAt),
    projectIds: keyProjectIds(row)
  }
}

/** A key's project limit as stored: absent = unlimited. An empty list can't be created, but would limit to nothing. */
export function keyProjectIds(row: ParseObject): string[] | null {
  const ids = row.get('projectIds')
  return Array.isArray(ids) ? ids.map(String) : null
}
