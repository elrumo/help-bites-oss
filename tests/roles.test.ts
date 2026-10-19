import { describe, expect, test } from 'bun:test'
import { can, canGrant, ROLES } from '../shared/roles'

describe('roles', () => {
  test('agents answer and write; admins run the workspace; owners pay and delete', () => {
    expect(can('agent', 'inbox')).toBe(true)
    expect(can('agent', 'content')).toBe(true)
    expect(can('agent', 'projects.manage')).toBe(false)
    expect(can('admin', 'team.manage')).toBe(true)
    expect(can('admin', 'billing')).toBe(false)
    expect(can('owner', 'workspace.delete')).toBe(true)
    expect(can(null, 'inbox')).toBe(false)
  })

  test('you hand out at most your own role, and only owners make owners', () => {
    expect(canGrant('owner', 'owner')).toBe(true)
    expect(canGrant('admin', 'owner')).toBe(false)
    expect(canGrant('admin', 'admin')).toBe(true)
    expect(canGrant('admin', 'agent')).toBe(true)
    expect(ROLES.some(role => canGrant('agent', role))).toBe(false)
  })
})
