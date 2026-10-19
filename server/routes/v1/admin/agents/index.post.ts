import { canGrant, isRole } from '#shared/roles'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Add a teammate',
    description: 'Creates an operator account with a password and adds it to this workspace, or adds the existing operator with that email. Where accounts are created by invitation only (the hosted edition), use POST /v1/admin/invitations instead.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string', minLength: 8 }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'agent'], default: 'admin' } } } } } },
    responses: { 200: { description: '{ agent }' }, 402: { description: 'The plan\'s teammate limit is reached.' }, 409: { description: 'Username or email taken, or already a member' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'team.manage' })
  if (!edition().policy.teammatePasswords) throw createError({ statusCode: 403, statusMessage: 'Invite teammates by email instead', data: { code: 'invite_only' } })
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  // Everyone a one-team install had was a full admin; new teammates still are unless told otherwise.
  const role = isRole(payload.role) ? payload.role : 'admin'
  if (!canGrant(ctx.role, role)) throw createError({ statusCode: 403, statusMessage: 'You cannot give that role', data: { code: 'forbidden_role' } })

  const Parse = useParse()
  const email = String(payload.email || '').trim()
  let user = email ? await findAgentByEmail(email) : null
  if (user && await findMember(ctx.workspaceId, user.id || '')) throw createError({ statusCode: 409, statusMessage: 'They are already in this workspace' })
  await checkGauge(ctx.workspace, 'seats')
  if (!user) user = await new Parse.Query(Parse.User).get((await createAgent(payload)).id, MASTER)
  await addMember(ctx.workspace, user, role)
  if (!user.get('defaultWorkspace')) {
    user.set('defaultWorkspace', ctx.workspace)
    await user.save(null, MASTER)
  }
  return { agent: { ...serializeAgent(user), role } }
})
