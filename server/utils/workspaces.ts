import { createHash, randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { canGrant, isRole, type Role } from '#shared/roles'

// Workspaces, their members and invitations: the rows behind tenancy.ts.
// Parse cannot make (workspace, user) unique, so every membership write
// holds a Redis lock and reads before it writes.

export type WorkspaceSummary = { id: string, name: string, status: string, role: Role | null, createdAt: string | null }
export type Member = { id: string, username: string, email: string, name: string, role: Role, createdAt: string | null }
export type Invitation = { id: string, email: string, role: Role, expiresAt: string | null, invitedBy: string, createdAt: string | null }

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function serializeWorkspace(row: ParseObject, role: Role | null = null): WorkspaceSummary {
  return { id: row.id || '', name: String(row.get('name') || 'Workspace'), status: String(row.get('status') || 'active'), role, createdAt: iso(row.createdAt) }
}

function roleOf(row: ParseObject): Role {
  const role = row.get('role')
  return isRole(role) ? role : 'agent'
}

export function workspaceName(value: unknown): string {
  const name = String(value || '').trim().slice(0, 80)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Name the workspace' })
  return name
}

/** A workspace with its creator as owner (and, if they have none yet, as their default). */
export async function createWorkspace(input: { name: string, owner: ParseObject }): Promise<ParseObject> {
  const Parse = useParse()
  const workspace = new (Parse.Object.extend('Workspace'))()
  workspace.set('name', workspaceName(input.name))
  workspace.set('status', 'active')
  workspace.set('owner', input.owner)
  await workspace.save(null, MASTER)
  await addMember(workspace, input.owner, 'owner')
  if (!input.owner.get('defaultWorkspace')) {
    input.owner.set('defaultWorkspace', workspace)
    await input.owner.save(null, MASTER)
  }
  return workspace
}

function memberQuery(workspace: ParseObject | string, userId?: string) {
  const Parse = useParse()
  const query = new Parse.Query('WorkspaceMember').equalTo('workspace', typeof workspace === 'string' ? Parse.Object.extend('Workspace').createWithoutData(workspace) : workspace)
  if (userId) query.equalTo('user', Parse.User.createWithoutData(userId))
  return query
}

/** Add someone, or change the role of who is already in. */
export async function addMember(workspace: ParseObject, user: ParseObject, role: Role): Promise<ParseObject> {
  const Parse = useParse()
  const result = await runExclusive(`sb:ws:member:${workspace.id}:${user.id}`, 15, async () => {
    const existing = await memberQuery(workspace, user.id).first(MASTER)
    const row = existing || new (Parse.Object.extend('WorkspaceMember'))()
    row.set('workspace', workspace)
    row.set('user', user)
    row.set('role', role)
    await row.save(null, MASTER)
    return row
  }, { waitMs: 5000, failOpen: true })
  if (!result.ran) throw createError({ statusCode: 409, statusMessage: 'That membership is being changed; try again' })
  await invalidate('members', user.id || '')
  return result.value
}

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const rows = await memberQuery(workspaceId).include('user').ascending('createdAt').limit(1000).find(MASTER)
  return rows.flatMap((row) => {
    const user = row.get('user') as ParseObject | undefined
    return user ? [{ ...serializeAgent(user), role: roleOf(row), createdAt: iso(row.createdAt) }] : []
  })
}

export async function findMember(workspaceId: string, userId: string): Promise<ParseObject | null> {
  return await memberQuery(workspaceId, userId).first(MASTER) || null
}

async function ownerCount(workspaceId: string): Promise<number> {
  return memberQuery(workspaceId).equalTo('role', 'owner').count(MASTER)
}

/** Change a member's role. Only owners touch owners, and a workspace always keeps one. */
export async function setMemberRole(ctx: MemberContext, userId: string, role: Role): Promise<Member> {
  const row = await findMember(ctx.workspaceId, userId)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  const current = roleOf(row)
  if ((current === 'owner' || role === 'owner') && ctx.role !== 'owner') throw createError({ statusCode: 403, statusMessage: 'Only an owner can change an owner', data: { code: 'forbidden_role' } })
  if (!canGrant(ctx.role, role)) throw createError({ statusCode: 403, statusMessage: 'You cannot give that role', data: { code: 'forbidden_role' } })
  if (current === 'owner' && role !== 'owner' && await ownerCount(ctx.workspaceId) <= 1) throw createError({ statusCode: 400, statusMessage: 'A workspace needs an owner; make someone else owner first' })
  row.set('role', role)
  await row.save(null, MASTER)
  await invalidate('members', userId)
  const user = await new (useParse()).Query(useParse().User).get(userId, MASTER)
  return { ...serializeAgent(user), role, createdAt: iso(row.createdAt) }
}

/**
 * Take someone out of a workspace, with the API keys they made for it.
 * Returns how many workspaces they still belong to.
 */
export async function removeMember(ctx: MemberContext, userId: string): Promise<number> {
  const Parse = useParse()
  const row = await findMember(ctx.workspaceId, userId)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  if (roleOf(row) === 'owner') {
    if (ctx.role !== 'owner') throw createError({ statusCode: 403, statusMessage: 'Only an owner can remove an owner', data: { code: 'forbidden_role' } })
    if (await ownerCount(ctx.workspaceId) <= 1) throw createError({ statusCode: 400, statusMessage: 'A workspace needs an owner; make someone else owner first' })
  }
  const user = Parse.User.createWithoutData(userId)
  const keys = await new Parse.Query('AdminApiKey').equalTo('agent', user).equalTo('workspace', ctx.workspace).limit(1000).find(MASTER)
  await Parse.Object.destroyAll(keys, MASTER)
  await row.destroy(MASTER)
  await invalidate('members', userId)
  return new Parse.Query('WorkspaceMember').equalTo('user', user).count(MASTER)
}

// ---- invitations -------------------------------------------------------------

function inviteTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function serializeInvitation(row: ParseObject): Invitation {
  const by = row.get('invitedBy') as ParseObject | undefined
  return {
    id: row.id || '',
    email: String(row.get('email') || ''),
    role: roleOf(row),
    expiresAt: iso(row.get('expiresAt')),
    invitedBy: String(by?.get?.('name') || by?.get?.('username') || ''),
    createdAt: iso(row.createdAt)
  }
}

export async function pendingInvitations(workspaceId: string): Promise<ParseObject[]> {
  const Parse = useParse()
  return new Parse.Query('WorkspaceInvite')
    .equalTo('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId))
    .doesNotExist('acceptedAt').greaterThan('expiresAt', new Date())
    .include('invitedBy').descending('createdAt').limit(200).find(MASTER)
}

export function inviteUrl(token: string): string {
  const base = (process.env.ADMIN_URL || process.env.APP_URL || 'http://localhost:3100').replace(/\/+$/, '')
  return `${base}/invite/${encodeURIComponent(token)}`
}

/**
 * Invite an address into the workspace. The link is mailed when email is
 * set up; either way it is returned, so an admin can pass it on by hand.
 */
export async function createInvitation(ctx: MemberContext, input: { email: string, role: Role }): Promise<{ invitation: Invitation, url: string, emailed: boolean }> {
  await assertWorkspaceVerified(ctx.workspaceId)
  const Parse = useParse()
  if (!canGrant(ctx.role, input.role)) throw createError({ statusCode: 403, statusMessage: 'You cannot give that role', data: { code: 'forbidden_role' } })
  const existingUser = await findAgentByEmail(input.email)
  if (existingUser && await findMember(ctx.workspaceId, existingUser.id || '')) throw createError({ statusCode: 409, statusMessage: 'They are already in this workspace' })

  // One live invitation per address: a new one replaces the old link.
  const stale = await new Parse.Query('WorkspaceInvite').equalTo('workspace', ctx.workspace).equalTo('email', input.email).doesNotExist('acceptedAt').find(MASTER)
  // A pending invitation holds a seat; sending a live one again only swaps the link, so it takes no new seat.
  const resending = stale.some(row => Number(row.get('expiresAt')?.getTime()) > Date.now())
  await checkGauge(ctx.workspace, 'seats', resending ? 0 : 1)
  await Parse.Object.destroyAll(stale, MASTER)

  const token = randomBytes(24).toString('base64url')
  const row = new (Parse.Object.extend('WorkspaceInvite'))()
  row.set('workspace', ctx.workspace)
  row.set('email', input.email)
  row.set('role', input.role)
  row.set('tokenHash', inviteTokenHash(token))
  row.set('expiresAt', new Date(Date.now() + INVITE_TTL_MS))
  row.set('invitedBy', ctx.agent)
  await row.save(null, MASTER)

  const url = inviteUrl(token)
  let emailed = false
  if (isMailerConfigured()) {
    const inviter = String(ctx.agent.get('name') || ctx.agent.get('username') || 'A teammate')
    const space = String(ctx.workspace.get('name') || 'their workspace')
    const html = `<p>${escapeHtml(inviter)} invited you to <strong>${escapeHtml(space)}</strong> on HelpBites.</p><p><a href="${url}">Accept the invitation</a></p><p>The link works for 7 days. If you weren't expecting this, ignore it.</p>`
    const text = `${inviter} invited you to ${space} on HelpBites.\n\nAccept the invitation (the link works for 7 days):\n\n${url}\n\nIf you weren't expecting this, ignore it.`
    const [result] = await deliverEmails([{
      project: null,
      to: { email: input.email, name: '' },
      subject: `Join ${space} on HelpBites`,
      html,
      text,
      sender: projectEmailSender(null, { fromName: 'HelpBites' }),
      log: { source: 'system', kind: 'message', templateName: 'Workspace invitation', batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
    }]).catch(() => [])
    emailed = !!result && result.status !== 'failed'
  }
  return { invitation: serializeInvitation(row), url, emailed }
}

/** A live invitation (not used, not expired) for this token, with its workspace. */
export async function findInvitation(token: string): Promise<ParseObject | null> {
  if (!token || token.length > 100) return null
  const row = await new (useParse()).Query('WorkspaceInvite').equalTo('tokenHash', inviteTokenHash(token)).include('workspace').include('invitedBy').first(MASTER)
  if (!row || row.get('acceptedAt')) return null
  const expiresAt = row.get('expiresAt') as Date | undefined
  if (!(expiresAt instanceof Date) || expiresAt.getTime() < Date.now()) return null
  return row
}

export async function acceptInvitation(row: ParseObject, user: ParseObject): Promise<ParseObject> {
  const workspace = row.get('workspace') as ParseObject
  const existing = await findMember(workspace.id || '', user.id || '')
  // Accepting never demotes someone who is already in.
  if (!existing) await addMember(workspace, user, roleOf(row))
  row.set('acceptedAt', new Date())
  await row.save(null, MASTER)
  user.set('defaultWorkspace', workspace)
  await user.save(null, MASTER)
  return workspace
}
