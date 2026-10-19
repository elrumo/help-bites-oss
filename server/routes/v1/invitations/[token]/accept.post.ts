defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Accept an invitation',
    description: 'Signed in (Authorization: Bearer r:…) as the invited address: joins the workspace. Not signed in: creates the account for the invited address with `password` (and `name`), joins, and returns a session. An invitation is the one way to create an account even where sign-up is closed.',
    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string', description: 'At least 8 characters' }, name: { type: 'string' } } } } } },
    responses: { 200: { description: '{ workspace, sessionToken?, agent }' }, 403: { description: 'Signed in as someone else' }, 409: { description: 'The address has an account: sign in first' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:invite:${clientIp(event) || 'ip'}`, 20, 600)
  const row = await findInvitation(getRouterParam(event, 'token') || '')
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This invitation is invalid, used or expired' })
  const email = String(row.get('email') || '')
  const Parse = useParse()

  if (optionalBearer(event).startsWith('r:')) {
    const { agent } = await requireAgentIdentity(event)
    if (String(agent.get('email') || '').trim().toLowerCase() !== email) {
      throw createError({ statusCode: 403, statusMessage: `This invitation is for ${email}; sign in with that account` })
    }
    const workspace = await acceptInvitation(row, agent)
    return { workspace: serializeWorkspace(workspace, null), agent: serializeAgent(agent) }
  }

  if (await findAgentByEmail(email)) throw createError({ statusCode: 409, statusMessage: 'That address already has an account; sign in to accept' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const password = String(body.password || '')
  const { id } = await createAgent({ username: email, email, password, name: body.name })
  const user = await new Parse.Query(Parse.User).get(id, MASTER)
  const workspace = await acceptInvitation(row, user)
  const session = await loginAgent(email, password)
  if (!session) throw createError({ statusCode: 500, statusMessage: 'Account created but sign-in failed; try signing in' })
  return { workspace: serializeWorkspace(workspace, null), ...session }
})
