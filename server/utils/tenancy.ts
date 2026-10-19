import { createError, getHeader, type H3Event } from 'h3'
import { can, isRole, type Action, type Role } from '#shared/roles'
import { invalidate, onInvalidate } from './cacheBus'

// Every operator request acts inside one workspace, and only sees what that
// workspace owns. requireMember resolves which one and checks the caller
// belongs to it; requireProject and the scoped loaders then refuse anything
// from another workspace with a 404, so a foreign id looks like no id.
//
// What belongs to a workspace: Project, AdminApiKey and the rows that may
// exist without a project (masters, shared components, assistants, models)
// carry a `workspace` pointer. Everything else hangs off a project, so it is
// scoped by `project ∈ the workspace's projects`; a project never moves.

export type MemberContext = AgentContext & { workspace: ParseObject, workspaceId: string, role: Role }
export type Membership = { workspaceId: string, role: Role }

function forbidden(statusMessage: string, code: string): never {
  throw createError({ statusCode: 403, statusMessage, data: { code } })
}

function notFound(what = 'Not found'): never {
  throw createError({ statusCode: 404, statusMessage: what })
}

// ---- caches -----------------------------------------------------------------

const MEMBERS_TTL_MS = 60_000
const memberCache = new Map<string, { rows: Membership[], expiresAt: number }>()
onInvalidate('members', userId => memberCache.delete(userId))

/** The workspaces an operator belongs to, oldest membership first. */
export async function membershipsOf(userId: string): Promise<Membership[]> {
  const hit = memberCache.get(userId)
  if (hit && hit.expiresAt > Date.now()) return hit.rows
  const Parse = useParse()
  const rows = await new Parse.Query('WorkspaceMember').equalTo('user', Parse.User.createWithoutData(userId)).ascending('createdAt').limit(500).find(MASTER)
  const list = rows.map(row => ({ workspaceId: pointerId(row.get('workspace')), role: (isRole(row.get('role')) ? row.get('role') : 'agent') as Role })).filter(m => m.workspaceId)
  if (memberCache.size > 5000) memberCache.delete(memberCache.keys().next().value!)
  memberCache.set(userId, { rows: list, expiresAt: Date.now() + MEMBERS_TTL_MS })
  return list
}

const WORKSPACE_TTL_MS = 30_000
const workspaceCache = new Map<string, { row: ParseObject, expiresAt: number }>()
onInvalidate('workspace', id => workspaceCache.delete(id))

export async function getWorkspace(id: string): Promise<ParseObject | null> {
  if (!id) return null
  const hit = workspaceCache.get(id)
  if (hit && hit.expiresAt > Date.now()) return hit.row
  const row = await new (useParse()).Query('Workspace').get(id, MASTER).catch(() => null)
  if (!row) return null
  if (workspaceCache.size > 5000) workspaceCache.delete(workspaceCache.keys().next().value!)
  workspaceCache.set(id, { row, expiresAt: Date.now() + WORKSPACE_TTL_MS })
  return row
}

// A project's workspace never changes, so this cache needs no invalidation.
const projectWorkspace = new Map<string, string>()

export async function workspaceIdOfProject(projectId: string): Promise<string> {
  if (!projectId) return ''
  const hit = projectWorkspace.get(projectId)
  if (hit) return hit
  const row = await new (useParse()).Query('Project').select('workspace').get(projectId, MASTER).catch(() => null)
  const workspaceId = pointerId(row?.get('workspace'))
  if (workspaceId) {
    if (projectWorkspace.size > 20_000) projectWorkspace.delete(projectWorkspace.keys().next().value!)
    projectWorkspace.set(projectId, workspaceId)
  }
  return workspaceId
}

const PROJECTS_TTL_MS = 60_000
const workspaceProjects = new Map<string, { ids: string[], expiresAt: number }>()
onInvalidate('workspaceProjects', id => workspaceProjects.delete(id))

/** Ids of every project in a workspace (a handful; capped at 1000). */
export async function workspaceProjectIds(workspaceId: string): Promise<string[]> {
  const hit = workspaceProjects.get(workspaceId)
  if (hit && hit.expiresAt > Date.now()) return hit.ids
  const Parse = useParse()
  const rows = await new Parse.Query('Project').equalTo('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId)).select('objectId').limit(1000).find(MASTER)
  const ids = rows.map(row => row.id || '').filter(Boolean)
  for (const id of ids) projectWorkspace.set(id, workspaceId)
  if (workspaceProjects.size > 5000) workspaceProjects.delete(workspaceProjects.keys().next().value!)
  workspaceProjects.set(workspaceId, { ids, expiresAt: Date.now() + PROJECTS_TTL_MS })
  return ids
}

// ---- which workspace a request acts in ---------------------------------------

/**
 * In order: an API key's own workspace (a key never acts elsewhere); the
 * X-Workspace header the panel sends; the only one, the operator's default,
 * or their oldest. The caller still checks membership of the result.
 */
export function chooseWorkspaceId(input: { header: string, apiKeyWorkspaceId: string, memberships: Membership[], defaultWorkspaceId: string }): { workspaceId: string } | { error: 'key_mismatch' | 'none' } {
  const header = input.header.trim()
  if (input.apiKeyWorkspaceId) {
    if (header && header !== input.apiKeyWorkspaceId) return { error: 'key_mismatch' }
    return { workspaceId: input.apiKeyWorkspaceId }
  }
  if (header) return { workspaceId: header }
  if (input.memberships.length === 1) return { workspaceId: input.memberships[0]!.workspaceId }
  if (input.defaultWorkspaceId && input.memberships.some(m => m.workspaceId === input.defaultWorkspaceId)) return { workspaceId: input.defaultWorkspaceId }
  if (input.memberships[0]) return { workspaceId: input.memberships[0].workspaceId }
  return { error: 'none' }
}

/** The caller's workspace without failing: null when they belong to none (or name one they are not in). */
export async function resolveMember(identity: AgentContext, header: string): Promise<MemberContext | null> {
  const memberships = await membershipsOf(identity.agentId)
  const choice = chooseWorkspaceId({ header, apiKeyWorkspaceId: identity.apiKeyWorkspaceId, memberships, defaultWorkspaceId: pointerId(identity.agent.get('defaultWorkspace')) })
  if ('error' in choice) return null
  const membership = memberships.find(m => m.workspaceId === choice.workspaceId)
  const workspace = membership ? await getWorkspace(choice.workspaceId) : null
  if (!membership || !workspace) return null
  return { ...identity, workspace, workspaceId: workspace.id || '', role: membership.role }
}

/**
 * The signed-in operator and the workspace this request acts in. `can` adds a
 * role check (shared/roles.ts); a suspended or deleting workspace is refused
 * unless `allowInactive` (reading your own account, billing, export). A key
 * limited to some projects is refused where the route is `workspaceWide` or
 * its role check is a workspace-level action.
 */
export async function requireMember(event: H3Event, options: { can?: Action, allowInactive?: boolean, workspaceWide?: boolean } = {}): Promise<MemberContext> {
  let ctx = event.context.member as MemberContext | undefined
  if (!ctx) {
    const identity = await requireAgentIdentity(event)
    const header = String(getHeader(event, 'x-workspace') || '')
    if (identity.apiKeyWorkspaceId && header.trim() && header.trim() !== identity.apiKeyWorkspaceId) forbidden('This API key belongs to another workspace', 'not_member')
    ctx = await resolveMember(identity, header) || forbidden('You are not a member of this workspace', 'not_member')
    event.context.member = ctx
    // Scripts using an API key share the plan's per-minute allowance; the panel, paced by a person, does not count.
    if (identity.apiKeyId) {
      const perMinute = (await workspacePlan(ctx.workspace)).apiPerMinute
      if (perMinute !== null) await rateLimit(`sb:rl:api:${ctx.workspaceId}`, perMinute, 60)
    }
  }
  const status = String(ctx.workspace.get('status') || 'active')
  if (status !== 'active' && !options.allowInactive) forbidden(status === 'suspended' ? 'This workspace is suspended' : 'This workspace is being deleted', 'workspace_suspended')
  if (options.can && !can(ctx.role, options.can)) forbidden('Your role in this workspace cannot do that', 'forbidden_role')
  if (options.workspaceWide || (options.can && !PROJECT_ACTIONS.includes(options.can))) assertWorkspaceWide(ctx)
  return ctx
}

// ---- scoping ------------------------------------------------------------------

/** What a key limited to some projects may do: work inside them (the rest of ACTIONS is the workspace's own). */
const PROJECT_ACTIONS: Action[] = ['inbox', 'content', 'marketing', 'assistants.manage']

/** 403 for a key limited to some projects: for what belongs to the workspace itself. */
export function assertWorkspaceWide(ctx: { apiKeyProjectIds?: string[] | null }): void {
  if (ctx.apiKeyProjectIds) forbidden('This API key is limited to specific projects', 'key_project_scope')
}

/** One of the caller's projects, or a 404, the same as a project that does not exist. */
export async function requireProject(ctx: MemberContext, projectId: string): Promise<ParseObject> {
  const project = await loadProjectUnscoped(String(projectId || ''))
  assertProjectInWorkspace(ctx, project)
  projectWorkspace.set(project.id || '', ctx.workspaceId)
  return project
}

/** Narrow a query over rows with an optional `project` (assistants, knowledge models) to a limited key's projects: a shared row, with none, is the workspace's. */
export function limitToKeyProjects<Q extends { containedIn(key: string, values: ParseObject[]): unknown }>(ctx: { apiKeyProjectIds?: string[] | null }, query: Q): Q {
  if (ctx.apiKeyProjectIds) {
    const Project = useParse().Object.extend('Project')
    query.containedIn('project', ctx.apiKeyProjectIds.map(id => Project.createWithoutData(id) as ParseObject))
  }
  return query
}

/** 404 unless an already-loaded project is the caller's (the row carries its workspace). */
export function assertProjectInWorkspace(ctx: { workspaceId: string, apiKeyProjectIds?: string[] | null }, project: ParseObject | null | undefined, what = 'Project not found'): asserts project is ParseObject {
  if (!project || pointerId(project.get('workspace')) !== ctx.workspaceId || (ctx.apiKeyProjectIds && !ctx.apiKeyProjectIds.includes(project.id || ''))) notFound(what)
}

/** Pointers to every project the caller may reach (a limited key: its own), for `containedIn('project', …)`. */
export async function projectPointers(ctx: MemberContext): Promise<ParseObject[]> {
  const Project = useParse().Object.extend('Project')
  return (await workspaceProjectIds(ctx.workspaceId)).filter(id => !ctx.apiKeyProjectIds || ctx.apiKeyProjectIds.includes(id)).map(id => Project.createWithoutData(id) as ParseObject)
}

/** 404 unless a row's own `workspace` is the caller's (a limited key: and its `project` is one of the key's). */
export function assertWorkspaceRow(ctx: MemberContext, row: ParseObject | null | undefined, what = 'Not found'): asserts row is ParseObject {
  if (!row || pointerId(row.get('workspace')) !== ctx.workspaceId || (ctx.apiKeyProjectIds && !ctx.apiKeyProjectIds.includes(pointerId(row.get('project'))))) notFound(what)
}

/** 404 unless a row's `project` belongs to the caller's workspace. */
export async function assertProjectRow(ctx: MemberContext, row: ParseObject | null | undefined, what = 'Not found'): Promise<void> {
  const projectId = row ? pointerId(row.get('project')) : ''
  if (!row || await workspaceIdOfProject(projectId) !== ctx.workspaceId || (ctx.apiKeyProjectIds && !ctx.apiKeyProjectIds.includes(projectId))) notFound(what)
}

/** 400 unless someone being assigned work belongs to the workspace it is in. */
export async function assertAssignable(workspaceId: string, userId: string): Promise<void> {
  if (!workspaceId || !(await membershipsOf(userId)).some(m => m.workspaceId === workspaceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Assignee not found' })
  }
}

/** A new project (or one deleted) changes the workspace's project list in every process. */
export async function forgetWorkspaceProjects(workspaceId: string): Promise<void> {
  await invalidate('workspaceProjects', workspaceId)
}

// ---- workspace state ---------------------------------------------------------------

/** Whether a workspace is open for business (not suspended, not being deleted). A workspace that can't be found counts as active: rows from before workspaces existed. */
export async function workspaceIsActive(workspaceId: string): Promise<boolean> {
  if (!workspaceId) return true
  const workspace = await getWorkspace(workspaceId)
  return !workspace || String(workspace.get('status') || 'active') === 'active'
}

// Only a yes is worth remembering, and only for a while: an owner who changes
// their address is unconfirmed again (me.patch.ts), on every replica within minutes.
const VERIFIED_TTL_MS = 5 * 60_000
const verifiedOwners = new Map<string, number>()

/**
 * Where the edition asks for it (cloud), a workspace whose owner has not
 * confirmed their email address can't reach anyone yet: no invitations,
 * no counted email, no API keys. 403 `email_unverified`.
 */
export async function assertWorkspaceVerified(workspaceId: string): Promise<void> {
  if (!edition().policy.requireVerifiedEmail || !workspaceId || (verifiedOwners.get(workspaceId) || 0) > Date.now()) return
  const workspace = await getWorkspace(workspaceId)
  const ownerId = pointerId(workspace?.get('owner'))
  const owner = ownerId ? await new (useParse()).Query(useParse().User).select('emailVerifiedAt').get(ownerId, MASTER).catch(() => null) : null
  if (owner?.get('emailVerifiedAt')) {
    verifiedOwners.set(workspaceId, Date.now() + VERIFIED_TTL_MS)
    return
  }
  throw createError({ statusCode: 403, statusMessage: 'Confirm your email address first: we sent you a link', data: { code: 'email_unverified' } })
}
