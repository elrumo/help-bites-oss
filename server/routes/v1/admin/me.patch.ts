defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Update your profile',
    description: 'Changes the signed-in agent\'s display name, email, the workspace they land in by default, and whether the welcome tour still waits for them (`tourPending: false` marks it finished or skipped). A blank email removes it (password reset emails then have nowhere to go). A new email is unconfirmed until its link is followed, where the edition asks for confirmation. Changing the email takes `currentPassword` and a signed-in session, not an API key, and the old address is told.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, defaultWorkspaceId: { type: 'string', description: 'A workspace you belong to' }, tourPending: { type: 'boolean', description: 'Send `false` once the welcome tour is finished or skipped; every new account starts with it `true`' }, currentPassword: { type: 'string', writeOnly: true } } } } } },
    responses: { 200: { description: '{ agent }' }, 400: { description: 'Invalid email' }, 403: { description: 'Wrong current password, or an API key tried to change the email' }, 409: { description: 'Email taken' } }
  }
})

export default defineEventHandler(async (event) => {
  const { agent, agentId, sessionToken } = await requireAgentIdentity(event)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  // Every check before any edit: the row is the session cache's copy.
  const previousEmail = String(agent.get('email') || '')
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : previousEmail
  if (email && !isProbablyEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  const emailChanged = email.toLowerCase() !== previousEmail.toLowerCase()
  if (emailChanged) {
    // Reset links go to this address, so changing it hands over the account:
    // it takes the password, not just a session someone might have lifted.
    if (sessionToken.startsWith('ak_')) throw createError({ statusCode: 403, statusMessage: 'An API key cannot change the account email; sign in to the panel' })
    await rateLimit(`sb:rl:reauth:${agentId}`, 10, 900)
    if (!await verifyAgentPassword(String(agent.get('username') || ''), String(body.currentPassword || ''))) {
      throw createError({ statusCode: 403, statusMessage: 'Your current password is incorrect' })
    }
  }
  if (typeof body.defaultWorkspaceId === 'string') {
    const id = body.defaultWorkspaceId.trim()
    if (!(await membershipsOf(agentId)).some(m => m.workspaceId === id)) throw createError({ statusCode: 403, statusMessage: 'You are not a member of that workspace', data: { code: 'not_member' } })
    agent.set('defaultWorkspace', useParse().Object.extend('Workspace').createWithoutData(id))
  }
  if (typeof body.name === 'string') agent.set('name', body.name.trim().slice(0, 120))
  // The tour only ever turns off here; the panel and the app replay it without asking the server.
  if (body.tourPending === false) agent.unset('tourPending')
  if (typeof body.email === 'string') {
    // A confirmation belongs to the address that was confirmed, never to the next one typed in.
    if (emailChanged) agent.unset('emailVerifiedAt')
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
  if (previousEmail && emailChanged) void sendAgentEmailChangedNotice(agent, previousEmail).catch(e => console.warn('[me] change notice failed:', (e as Error).message))
  return { agent: serializeAgent(agent) }
})
