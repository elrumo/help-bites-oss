import { createError, getHeader, type H3Event } from 'h3'
import { normalizeEmail } from '#shared/contacts'
import { invalidate, onInvalidate } from './cacheBus'
import { anonymousWriteGate, verifyAnonymousToken } from './endUserSessions'

// One `Authorization: Bearer` header for everyone, split by prefix:
//   r:…   a Parse session token → an agent (an operator; which workspaces it
//         may act in is server/utils/tenancy.ts's business)
//   ak_…  an admin API key → its agent, bound to one workspace
//   eu_…  an email-only user's session (endUserSessions.ts) → an end user of one project
//   else  a host-signed identity token → an end user of one project

/** Who is calling. `apiKeyWorkspaceId` is set for an `ak_` key: the only workspace it may act in; `apiKeyProjectIds` (when not null) the only projects, and then nothing workspace-wide. */
export type AgentContext = { agent: ParseObject, agentId: string, sessionToken: string, apiKeyId: string, apiKeyWorkspaceId: string, apiKeyProjectIds?: string[] | null }
export type EndUserContext = {
  project: ParseObject
  projectId: string
  claims: IdentityClaims
  /** Null until the user has written something (or `ensure` was requested). */
  endUser: ParseObject | null
}

function bearer(event: H3Event): string {
  const raw = getHeader(event, 'authorization') || ''
  const token = raw.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Missing Authorization header' })
  return token
}

// ---- agents ---------------------------------------------------------------

const SESSION_TTL_MS = 5 * 60 * 1000
const sessions = new Map<string, { agent: ParseObject, expiresAt: number }>()

export function forgetSession(token: string): void {
  void invalidate('session', token)
}

onInvalidate('session', token => sessions.delete(token))
onInvalidate('agent', (agentId) => {
  for (const [token, hit] of sessions) if (hit.agent.id === agentId) sessions.delete(token)
})

/** End every session an agent has, cached ones included (in every process):
 *  Parse may already have dropped the rows (it does on a password change),
 *  the caches have not. */
export async function revokeAgentSessions(agentId: string): Promise<void> {
  await invalidate('agent', agentId)
  const Parse = useParse()
  const rows = await new Parse.Query('_Session').equalTo('user', Parse.User.createWithoutData(agentId)).find(MASTER)
  await Parse.Object.destroyAll(rows, MASTER)
}

async function agentForSession(token: string): Promise<ParseObject | null> {
  const hit = sessions.get(token)
  if (hit && hit.expiresAt > Date.now()) return hit.agent

  const Parse = useParse()
  const session = await new Parse.Query('_Session').equalTo('sessionToken', token).include('user').first(MASTER)
  const agent = session?.get('user') as ParseObject | undefined
  if (!agent) return null
  const expiresAt = session!.get('expiresAt') as Date | undefined
  if (expiresAt instanceof Date && expiresAt.getTime() < Date.now()) return null

  if (sessions.size > 500) sessions.delete(sessions.keys().next().value!)
  sessions.set(token, { agent, expiresAt: Date.now() + SESSION_TTL_MS })
  return agent
}

/**
 * The signed-in operator, before any workspace is chosen. Routes act through
 * requireMember (server/utils/tenancy.ts), which adds the workspace; only
 * account-level routes (me, logout, the workspace list, devices) stop here.
 */
export async function requireAgentIdentity(event: H3Event): Promise<AgentContext> {
  const token = bearer(event)
  let agent: ParseObject | null = null
  let apiKeyId = ''
  let apiKeyWorkspaceId = ''
  let apiKeyProjectIds: string[] | null = null
  if (token.startsWith('r:')) agent = await agentForSession(token)
  else if (token.startsWith('ak_')) {
    const Parse = useParse()
    const key = await new Parse.Query('AdminApiKey').equalTo('hash', hashAdminApiKey(token)).include('agent').first(MASTER)
    agent = key?.get('agent') as ParseObject | null
    if (agent) {
      await rateLimit(`sb:rl:admin-key:${key!.id}`, 600, 60)
      if (adminApiKeyExpired(key!)) throw createError({ statusCode: 401, statusMessage: 'This API key has expired; create a new one' })
      noteAdminApiKeyUse(key!)
      apiKeyId = key!.id || ''
      apiKeyWorkspaceId = pointerId(key!.get('workspace'))
      apiKeyProjectIds = keyProjectIds(key!)
    } else await rateLimit(`sb:rl:bad-admin-key:${clientIp(event) || 'ip'}`, 20, 60)
  }
  if (!agent) throw createError({ statusCode: 401, statusMessage: 'Valid admin session or API key required' })
  return { agent, agentId: agent.id || '', sessionToken: token, apiKeyId, apiKeyWorkspaceId, apiKeyProjectIds }
}

/** Server-to-server authentication for host-initiated tickets. The project
 * secret is never accepted by browser/end-user routes. */
export async function requireProjectSecret(event: H3Event): Promise<ParseObject> {
  const token = bearer(event)
  if (!token.startsWith('sk_')) throw createError({ statusCode: 401, statusMessage: 'Project secret required' })
  const project = await new (useParse()).Query('Project').equalTo('secret', token).first(MASTER)
  // A suspended or deleting workspace's secret opens nothing, and says no more than a wrong one.
  if (!project || !(await workspaceIsActive(pointerId(project.get('workspace'))))) throw createError({ statusCode: 401, statusMessage: 'Invalid project secret' })
  await rateLimit(`sb:rl:project:${project.id}`, LIMITS.requestsPerProject.limit, LIMITS.requestsPerProject.window)
  return project
}

export function serializeAgent(agent: ParseObject) {
  return { id: agent.id || '', username: String(agent.get('username') || ''), email: String(agent.get('email') || ''), name: String(agent.get('name') || agent.get('username') || '') }
}

// ---- end users ------------------------------------------------------------

/** `write`: this call changes something, so an email-only user who has not verified their address is counted against their free writes. */
export async function requireEndUser(event: H3Event, options: { ensure?: boolean, write?: boolean } = {}): Promise<EndUserContext> {
  const token = bearer(event)
  if (token.startsWith('r:')) throw createError({ statusCode: 401, statusMessage: 'End-user identity token required' })

  const { project, claims } = await verifyEndUserToken(event, token)
  if (options.write) await anonymousWriteGate(project, claims)
  const endUser = options.ensure
    ? await ensureEndUser(project, claims)
    : await findEndUser(project, claims.sub)

  return { project, projectId: project.id || '', claims, endUser }
}

/** The bearer token when there is one, '' otherwise — for routes that also serve anonymous readers. */
export function optionalBearer(event: H3Event): string {
  return (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

/** Verify a host-signed identity token against its project and apply the per-project rate limit. */
export async function verifyEndUserToken(event: H3Event, token: string): Promise<{ project: ParseObject, claims: IdentityClaims }> {
  // An email-only user's opaque session (server/utils/endUserSessions.ts), not a host-signed token.
  if (token.startsWith('eu_')) return verifyAnonymousToken(event, token)
  const unverified = decodeUnverified(token)
  const project = unverified?.iss ? await findProjectByPublicKey(unverified.iss) : null
  if (!project) {
    await rateLimit(`sb:rl:badtoken:${clientIp(event) || 'ip'}`, LIMITS.badTokensPerIp.limit, LIMITS.badTokensPerIp.window)
    throw createError({ statusCode: 401, statusMessage: 'Unknown project' })
  }

  const result = verifyIdentityToken(token, String(project.get('secret') || ''), String(project.get('publicKey')))
  if (!result.ok) {
    await rateLimit(`sb:rl:badtoken:${clientIp(event) || 'ip'}`, LIMITS.badTokensPerIp.limit, LIMITS.badTokensPerIp.window)
    throw createError({ statusCode: 401, statusMessage: `Invalid identity token (${result.reason})` })
  }

  await rateLimit(`sb:rl:project:${project.id}`, LIMITS.requestsPerProject.limit, LIMITS.requestsPerProject.window)
  return { project, claims: result.claims }
}

export async function findEndUser(project: ParseObject, externalId: string): Promise<ParseObject | null> {
  const Parse = useParse()
  const row = await new Parse.Query('EndUser').equalTo('project', project).equalTo('externalId', externalId).first(MASTER)
  return row || null
}

/** Create the EndUser row on first write; refresh name/email when the token says they changed. */
export async function ensureEndUser(project: ParseObject, claims: { sub: string, name?: string, email?: string, username?: string, avatar?: string }): Promise<ParseObject> {
  const Parse = useParse()
  const name = String(claims.name || '').trim().slice(0, 120)
  const email = normalizeEmail(claims.email)
  const username = normalizeHandle(claims.username)
  const avatar = safeAvatarUrl(claims.avatar)

  let row = await findEndUser(project, claims.sub)
  let dirty = false
  if (!row && email) {
    // Someone who signed up or was imported by address becomes this user:
    // one person, one contact. Only a row no other id has claimed.
    row = await new Parse.Query('EndUser').equalTo('project', project).equalTo('email', email).doesNotExist('externalId').first(MASTER) || null
    if (row) { row.set('externalId', claims.sub); dirty = true }
  }
  if (!row) {
    row = new (Parse.Object.extend('EndUser'))()
    row!.set('project', project)
    row!.set('externalId', claims.sub)
    row!.set('subscription', 'none')
  }
  dirty ||= row!.isNew()
  if (name && row!.get('name') !== name) { row!.set('name', name); dirty = true }
  if (email && row!.get('email') !== email) { row!.set('email', email); dirty = true }
  if (username && row!.get('username') !== username) { row!.set('username', username); dirty = true }
  if (avatar && row!.get('avatarUrl') !== avatar) { row!.set('avatarUrl', avatar); dirty = true }
  const lastSeen = row!.get('lastSeenAt') as Date | undefined
  if (!lastSeen || Date.now() - lastSeen.getTime() > 10 * 60 * 1000) { row!.set('lastSeenAt', new Date()); dirty = true }
  if (dirty) { await row!.save(null, MASTER); void syncEndUserForSearch(row!) }
  return row!
}

/** A mentionable handle: no `@`, no email addresses (a handle is public). Case is kept — hosts may link by it; mentions match case-insensitively. */
export function normalizeHandle(value: unknown): string {
  const handle = String(value ?? '').trim().replace(/^@+/, '')
  return /^[a-z0-9][\w.-]{0,38}$/i.test(handle) ? handle : ''
}

export function safeAvatarUrl(value: unknown): string {
  const url = String(value ?? '').trim()
  return url.length <= 500 && /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : ''
}

export function serializeEndUser(row: ParseObject) {
  return {
    id: row.id || '',
    externalId: String(row.get('externalId') || ''),
    name: String(row.get('name') || ''),
    email: String(row.get('email') || ''),
    lastSeenAt: iso(row.get('lastSeenAt')),
    createdAt: iso(row.createdAt)
  }
}
