import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLP_MASTER_ONLY, OPERATIONS, PUBLIC_ACL_WHERE, SYSTEM_CLASSES, clpDiffers, clpFindings, describePermission, opensToEveryone, readableAnonymously, undeclared } from '../scripts/schemaSecurity.mjs'

// What scripts/ensure-schema.mjs enforces about who may touch Parse data.

describe('class-level permissions', () => {
  test('the locked policy has nothing to report against itself', () => {
    expect(clpFindings(CLP_MASTER_ONLY)).toEqual([])
    expect(clpDiffers(CLP_MASTER_ONLY, CLP_MASTER_ONLY)).toBe(false)
    expect(opensToEveryone(CLP_MASTER_ONLY)).toBe(false)
    // Key order is Parse's business.
    expect(clpDiffers({ protectedFields: { '*': [] }, addField: {}, delete: {}, update: {}, create: {}, count: {}, get: {}, find: {} }, CLP_MASTER_ONLY)).toBe(false)
  })

  test('a permission that is missing is Parse\'s default, which is everyone', () => {
    expect(clpFindings({})).toEqual(OPERATIONS.map(operation => `${operation}: unset, so open to everyone`).concat('protectedFields: not as expected'))
    expect(opensToEveryone({})).toBe(true)
    expect(opensToEveryone({ ...CLP_MASTER_ONLY, find: undefined })).toBe(true)
  })

  test('says who is let in, in words', () => {
    expect(describePermission({})).toBe('master key only')
    expect(describePermission({ '*': true })).toBe('everyone')
    expect(describePermission({ requiresAuthentication: true })).toBe('any signed-in user')
    expect(describePermission({ 'role:staff': true, abc123: true })).toBe('role:staff, user abc123')
    expect(describePermission({ pointerFields: ['owner'] })).toContain('owner')
    expect(opensToEveryone({ ...CLP_MASTER_ONLY, get: { '*': true } })).toBe(true)
    expect(opensToEveryone({ ...CLP_MASTER_ONLY, get: { requiresAuthentication: true } })).toBe(false)
  })

  test('finds each operation that is wider than master only, and access by a row\'s own fields', () => {
    const loose = { ...CLP_MASTER_ONLY, find: { '*': true }, delete: { requiresAuthentication: true }, readUserFields: ['owner'], writeUserFields: [] }
    expect(clpFindings(loose)).toEqual(['find: everyone', 'delete: any signed-in user', 'readUserFields: ["owner"]'])
    // Parse's own default also carries an ACL entry on a class it created.
    expect(clpFindings({ ...CLP_MASTER_ONLY, ACL: { '*': { read: true, write: true } } })).toEqual(['ACL: {"*":{"read":true,"write":true}}'])
  })

  test('a protected field list that hides nothing is the policy; one that is gone is not', () => {
    expect(clpFindings({ ...CLP_MASTER_ONLY, protectedFields: undefined })).toEqual(['protectedFields: not as expected'])
  })
})

describe('classes the script does not declare', () => {
  test('Parse\'s own are system, anything else is a stray; declared ones are left to their definition', () => {
    const schemas = [{ className: 'Workspace' }, { className: '_Role' }, { className: '_Session' }, { className: 'OldThing' }, { className: '_User' }]
    expect(undeclared(schemas, ['Workspace', '_User'])).toEqual([
      { className: '_Role', kind: 'system' },
      { className: '_Session', kind: 'system' },
      { className: 'OldThing', kind: 'stray' }
    ])
    expect(SYSTEM_CLASSES).toContain('_Installation')
  })
})

describe('row ACLs and the anonymous probe', () => {
  test('a row is open when it has no ACL or names everyone, for reading or for writing', () => {
    expect(PUBLIC_ACL_WHERE).toEqual({ $or: [{ _rperm: { $in: [null, '*'] } }, { _wperm: { $in: [null, '*'] } }] })
  })

  test('any 2xx to a request without a key means a stranger got in', () => {
    expect([200, 204].map(readableAnonymously)).toEqual([true, true])
    expect([400, 401, 403, 404, 500].map(readableAnonymously)).toEqual([false, false, false, false, false])
  })
})

describe('what ensure-schema.mjs declares', () => {
  const script = readFileSync(join(import.meta.dir, '../scripts/ensure-schema.mjs'), 'utf8')

  test('it asks for master-only on every class it creates or updates, from the shared policy', () => {
    expect(script).toContain("from './schemaSecurity.mjs'")
    expect(script).toContain('classLevelPermissions: wantedClp')
    // No second, hand-written policy to drift from the shared one.
    expect(script).not.toContain('const MASTER_ONLY')
    expect(script.match(/const USER_CLP = \{ \.\.\.CLP_MASTER_ONLY \}/g)).toHaveLength(1)
  })
})
