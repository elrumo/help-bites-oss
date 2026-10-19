// What each member of a workspace may do. Shared by the server (requireMember
// checks it) and the panel (hides what the role cannot use).
//
// agent  answers the inbox and edits content (feedback, board, changelog,
//        knowledge, email templates)
// admin  also runs the workspace: projects and their secrets, assistants,
//        marketing, the team, API keys and workspace settings
// owner  also billing, deleting the workspace and managing other owners

export const ROLES = ['owner', 'admin', 'agent'] as const
export type Role = typeof ROLES[number]

export const ACTIONS = {
  inbox: 'agent',
  content: 'agent',
  marketing: 'admin',
  'projects.manage': 'admin',
  'assistants.manage': 'admin',
  'team.manage': 'admin',
  'apiKeys.manage': 'admin',
  'workspace.settings': 'admin',
  'workspace.export': 'admin',
  billing: 'owner',
  'workspace.delete': 'owner',
  'owners.manage': 'owner'
} as const satisfies Record<string, Role>
export type Action = keyof typeof ACTIONS

const RANK: Record<Role, number> = { agent: 1, admin: 2, owner: 3 }

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export function roleRank(role: Role): number {
  return RANK[role] || 0
}

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && roleRank(role) >= roleRank(ACTIONS[action])
}

/** A member may hand out at most their own role, and only owners make owners. */
export function canGrant(granter: Role, role: Role): boolean {
  return role === 'owner' ? granter === 'owner' : roleRank(granter) >= roleRank(role) && can(granter, 'team.manage')
}

export const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', agent: 'Agent' }
