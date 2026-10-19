defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Create the first agent',
    description: 'Only works while no agent exists; it creates the first workspace with this agent as its owner. Afterwards it answers 409 and teammates are added from the panel. When the server sets SETUP_TOKEN, pass it as `setupToken`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string', minLength: 8 }, email: { type: 'string' }, name: { type: 'string' }, workspaceName: { type: 'string' }, setupToken: { type: 'string' } } } } } },
    responses: { 200: { description: '{ sessionToken, agent }' }, 403: { description: 'Wrong setup token' }, 409: { description: 'Setup already done' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:login:${clientIp(event) || 'ip'}`, LIMITS.adminLoginPerIp.limit, LIMITS.adminLoginPerIp.window)
  if (edition().policy.signup !== 'setup') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  // Whoever reaches a fresh install first owns it; SETUP_TOKEN keeps that to
  // whoever deployed it.
  if (!setupTokenMatches(payload.setupToken)) throw createError({ statusCode: 403, statusMessage: 'That setup token is not the one this server was given' })
  // Check-then-create under one lock: two first visitors cannot both become the owner.
  const created = await runExclusive('sb:setup', 30, async () => {
    if ((await countAgents()) > 0) throw createError({ statusCode: 409, statusMessage: 'Setup is already done; sign in instead' })
    const { id } = await createAgent(payload)
    const owner = await new (useParse()).Query(useParse().User).get(id, MASTER)
    await createWorkspace({ name: String(payload.workspaceName || process.env.DEFAULT_WORKSPACE_NAME || 'HelpBites'), owner })
  }, { waitMs: 10_000 })
  if (!created.ran) throw createError({ statusCode: 503, statusMessage: 'Setup is busy; try again in a moment' })
  // A master-key create returns no session; sign the new operator in.
  const session = await loginAgent(String(payload.username || '').trim(), String(payload.password || ''))
  if (!session) throw createError({ statusCode: 500, statusMessage: 'Account created but sign-in failed; try signing in' })
  return session
})
