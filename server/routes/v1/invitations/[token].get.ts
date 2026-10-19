defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Look at an invitation',
    description: 'What the invitation link is for, so the page can ask the right thing: sign in (the address already has an account) or create an account. Unauthenticated; the token is the credential.',
    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ workspace, email, role, invitedBy, hasAccount }' }, 404: { description: 'Unknown, used or expired' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:invite:${clientIp(event) || 'ip'}`, 60, 600)
  const row = await findInvitation(getRouterParam(event, 'token') || '')
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This invitation is invalid, used or expired' })
  const invitation = serializeInvitation(row)
  return {
    workspace: { name: String((row.get('workspace') as ParseObject).get('name') || '') },
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    hasAccount: !!(await findAgentByEmail(invitation.email))
  }
})
