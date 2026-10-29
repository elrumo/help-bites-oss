// What ensure-schema.mjs checks and enforces about who may touch Parse data.
//
// Every class is master-only: the app talks to Parse with the master key
// and nothing else (browsers and apps go through /v1, never to Parse). So the
// only correct class-level permission is "nobody but the master key", on every
// class Parse holds: the ones declared in ensure-schema.mjs, Parse's own
// (_Role, _Session, _Installation…) and any stray class an older version or a
// hand-run script left behind. A permission that is missing from a CLP is not
// "denied", it is Parse's default, which is everyone, so a class Parse created
// on its own on first write starts out open until this script closes it.
//
// Row ACLs are the second layer. A row saved over REST without an ACL is
// readable and writable by everyone as far as Parse's row check goes; the
// master-only CLP is what stops that mattering. `--acls` finds those rows and
// gives them an empty ACL (see ensure-schema.mjs).

const MASTER_ONLY = {}

export const OPERATIONS = ['find', 'count', 'get', 'create', 'update', 'delete', 'addField']

export const CLP_MASTER_ONLY = {
  find: MASTER_ONLY, get: MASTER_ONLY, count: MASTER_ONLY,
  create: MASTER_ONLY, update: MASTER_ONLY, delete: MASTER_ONLY,
  addField: MASTER_ONLY, protectedFields: { '*': [] }
}

/** Classes Parse creates and uses itself. Anything else that is not declared in ensure-schema.mjs is a stray. */
export const SYSTEM_CLASSES = [
  '_User', '_Role', '_Session', '_Installation', '_Audience', '_PushStatus', '_JobStatus', '_JobSchedule',
  '_Hooks', '_GlobalConfig', '_GraphQLConfig', '_Idempotency'
]

/** Rows of these keep the ACL Parse gave them: a session is already owner-only and Parse rewrites it itself. */
export const ACL_SKIPPED = ['_Session', '_Hooks', '_GlobalConfig', '_GraphQLConfig', '_Idempotency', '_JobSchedule']

/** Parse returns the CLP keys in its own order; compare structurally. */
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  }
  return value
}

const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

export function clpDiffers(existing, wanted) {
  return !same(existing || {}, wanted)
}

/** A permission as a person would say it. */
export function describePermission(value) {
  if (value === undefined || value === null) return 'unset, so open to everyone'
  const keys = Object.keys(value)
  if (!keys.length) return 'master key only'
  return keys.map(key => key === '*' ? 'everyone' : key === 'requiresAuthentication' ? 'any signed-in user' : key.startsWith('role:') ? key : key === 'pointerFields' ? `rows pointing at the caller (${[].concat(value[key]).join(', ')})` : `user ${key}`).join(', ')
}

/**
 * What differs from `wanted` in a class's permissions, one sentence each.
 * Empty when the class is as locked as it should be.
 */
export function clpFindings(existing, wanted = CLP_MASTER_ONLY) {
  const current = existing || {}
  const out = []
  for (const operation of OPERATIONS) {
    // Unset is Parse's default, which is everyone: never the same as a permission written down.
    if (current[operation] === undefined || !same(current[operation], wanted[operation])) out.push(`${operation}: ${describePermission(current[operation])}`)
  }
  // Keys that grant access by a row's own fields, or anything this script does not know.
  for (const key of Object.keys(current)) {
    if (OPERATIONS.includes(key) || key === 'protectedFields') continue
    if (!same(current[key], wanted[key] ?? (Array.isArray(current[key]) ? [] : {}))) out.push(`${key}: ${JSON.stringify(current[key])}`)
  }
  if (!same(current.protectedFields ?? null, wanted.protectedFields ?? null)) out.push('protectedFields: not as expected')
  return out
}

/** Whether any operation of a CLP lets anyone at all in, signed in or not. */
export function opensToEveryone(existing) {
  const current = existing || {}
  return OPERATIONS.some(operation => current[operation] === undefined || current[operation]?.['*'])
}

/**
 * The classes Parse holds that ensure-schema.mjs does not declare, each as
 * `{ className, kind: 'system' | 'stray' }`: they get locked down all the same.
 */
export function undeclared(schemas, declared) {
  const known = new Set(declared)
  return schemas
    .map(schema => schema.className)
    .filter(className => !known.has(className))
    .map(className => ({ className, kind: SYSTEM_CLASSES.includes(className) ? 'system' : 'stray' }))
}

/** Rows anyone can read or write as far as their ACL goes: no ACL at all, or `*` in it. */
export const PUBLIC_ACL_WHERE = {
  $or: [
    { _rperm: { $in: [null, '*'] } },
    { _wperm: { $in: [null, '*'] } }
  ]
}

/** An ACL that lets nobody but the master key in. */
export const PRIVATE_ACL = {}

/**
 * Whether a response to an unauthenticated read of a class means the class is
 * open: Parse answers 200 with rows (or none) when the CLP lets the caller in,
 * and 403/119 when it does not.
 */
export function readableAnonymously(status) {
  return status >= 200 && status < 300
}
