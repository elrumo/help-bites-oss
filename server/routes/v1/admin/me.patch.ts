defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Update your profile',
    description: 'Changes the signed-in agent\'s display name, email, and the workspace they land in by default. A blank email removes it (password reset emails then have nowhere to go). A new email is unconfirmed until its link is followed, where the edition asks for confirmation.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, defaultWorkspaceId: { type: 'string', description: 'A workspace you belong to' } } } } } },
    responses: { 200: { description: '{ agent }' }, 400: { description: 'Invalid email' }, 409: { description: 'Email taken' } }
  }
})

export default defineEventHandler(async (event) => {
  const { agent, agentId } = await requireAgentIdentity(event)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (typeof body.defaultWorkspaceId === 'string') {
    const id = body.defaultWorkspaceId.trim()
    if (!(await membershipsOf(agentId)).some(m => m.workspaceId === id)) throw createError({ statusCode: 403, statusMessage: 'You are not a member of that workspace', data: { code: 'not_member' } })
    agent.set('defaultWorkspace', useParse().Object.extend('Workspace').createWithoutData(id))
  }
  if (typeof body.name === 'string') agent.set('name', body.name.trim().slice(0, 120))
  if (typeof body.email === 'string') {
    const email = body.email.trim().slice(0, 200)
    if (email && !isProbablyEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
    // A confirmation belongs to the address that was confirmed, never to the next one typed in.
    if (email.toLowerCase() !== String(agent.get('email') || '').toLowerCase()) agent.unset('emailVerifiedAt')
    if (email) agent.set('email', email)
    else agent.unset('email')
  }
  try {
    await agent.save(null, MASTER)
  } catch (error: any) {
    // The row is the session cache's copy: drop the failed edit so it is not served later.
    agent.revert()
    if (error?.code === 203) throw createError({ statusCode: 409, statusMessage: 'That email is already taken' })
    throw error
  }
  return { agent: serializeAgent(agent) }
})
