import { describe, expect, test } from 'bun:test'
import { emailLogNeedsWorkspace, needsDefaultWorkspace, planMemberships, workspaceForRow } from './migrate-workspaces.mjs'

const user = (objectId, createdAt, defaultWorkspace) => ({ objectId, createdAt, ...(defaultWorkspace ? { defaultWorkspace: { objectId: defaultWorkspace } } : {}) })

describe('first workspace', () => {
  test('only an install with data and no workspace gets one', () => {
    expect(needsDefaultWorkspace({ workspaceCount: 0, userCount: 2, projectCount: 0 })).toBe(true)
    expect(needsDefaultWorkspace({ workspaceCount: 0, userCount: 0, projectCount: 3 })).toBe(true)
    expect(needsDefaultWorkspace({ workspaceCount: 0, userCount: 0, projectCount: 0 })).toBe(false)
    expect(needsDefaultWorkspace({ workspaceCount: 1, userCount: 5, projectCount: 5 })).toBe(false)
  })
})

describe('memberships', () => {
  const users = [user('b', '2026-02-01'), user('a', '2026-01-01'), user('c', '2026-03-01')]

  test('first run: the oldest operator owns it, everyone else is an admin, all land there by default', () => {
    const plan = planMemberships({ users, memberUserIds: [], workspaceId: 'W', firstRun: true, adoptOrphans: false })
    expect(plan.creates.map(m => [m.user.objectId, m.role])).toEqual([['a', 'owner'], ['b', 'admin'], ['c', 'admin']])
    expect(plan.defaults).toEqual(['a', 'b', 'c'])
  })

  test('later runs adopt orphans only where the edition allows it', () => {
    const settled = [user('a', '2026-01-01', 'W'), user('z', '2026-05-01')]
    expect(planMemberships({ users: settled, memberUserIds: ['a'], workspaceId: 'W', firstRun: false, adoptOrphans: true }).creates.map(m => [m.user.objectId, m.role])).toEqual([['z', 'admin']])
    expect(planMemberships({ users: settled, memberUserIds: ['a'], workspaceId: 'W', firstRun: false, adoptOrphans: false })).toEqual({ creates: [], defaults: [] })
  })

  test('a second run plans nothing', () => {
    const settled = users.map(u => ({ ...u, defaultWorkspace: { objectId: 'W' } }))
    expect(planMemberships({ users: settled, memberUserIds: ['a', 'b', 'c'], workspaceId: 'W', firstRun: false, adoptOrphans: true })).toEqual({ creates: [], defaults: [] })
  })
})

describe('placing rows', () => {
  const ctx = { projectWorkspace: new Map([['p1', 'W1']]), userWorkspace: new Map([['u2', 'W2']]), fallbackId: 'W0' }

  test('a row follows its project, then its operator, then the oldest workspace', () => {
    expect(workspaceForRow({ project: { objectId: 'p1' } }, ctx)).toBe('W1')
    expect(workspaceForRow({ agent: { objectId: 'u2' } }, ctx)).toBe('W2')
    expect(workspaceForRow({}, ctx)).toBe('W0')
  })

  test('the system\'s own mail stays outside every workspace', () => {
    expect(emailLogNeedsWorkspace({ source: 'system' })).toBe(false)
    expect(emailLogNeedsWorkspace({ source: 'admin' })).toBe(true)
    expect(emailLogNeedsWorkspace({ source: 'admin', project: { objectId: 'p' } })).toBe(false)
  })
})
