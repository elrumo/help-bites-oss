import Parse from 'parse/node'

// The app is the only master-key holder. Every class has master-only CLPs, so
// there is no session-token path to worry about: every query and write here
// runs with `MASTER`, and authorization is decided in the route handlers.

let initialized = false

export function useParse(): typeof Parse {
  if (!initialized) {
    const appId = process.env.PARSE_ID
    const masterKey = process.env.PARSE_MASTER_KEY
    const serverURL = process.env.PARSE_URL
    if (!appId || !masterKey || !serverURL) {
      throw new Error('PARSE_ID, PARSE_MASTER_KEY and PARSE_URL must be set')
    }
    Parse.initialize(appId, undefined, masterKey)
    Parse.serverURL = serverURL
    initialized = true
  }
  return Parse
}

export const MASTER = { useMasterKey: true } as const

export type ParseObject = Parse.Object

/** Pointer/object id extraction that tolerates fetched objects, pointers and plain JSON. */
export function pointerId(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const v = value as { id?: unknown, objectId?: unknown }
  if (typeof v.id === 'string') return v.id
  if (typeof v.objectId === 'string') return v.objectId
  return ''
}

export function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string') return value
  return null
}
