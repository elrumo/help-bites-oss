defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Connect a project to an error tracker', operationId: 'connectErrorTracking', security: [{ AgentSession: [] }, { AdminApiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, server: { type: 'string', description: 'An id from `GET /v1/admin/errors/servers`' }, provider: { type: 'string', enum: ['glitchtip', 'bugsink'], description: 'Without `server`: that tracker\'s first server' }, team: { type: 'string', description: 'Bugsink team to create the project under (made if missing). Default: the server\'s team. Pick one you belong to, or the project is only under Other Projects.' } } } } } }, responses: { 200: { description: '`{ project }`' }, 409: { description: 'Already connected to the other tracker.' }, 404: { description: 'No such server.' }, 501: { description: 'No server for that tracker.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = (await readBody(event).catch(() => ({}))) as { project?: string, server?: string, provider?: string, team?: string }
  const project = await requireProject(ctx, String(body.project || ''))
  const provider = body.provider || 'glitchtip'
  if (!isErrorProvider(provider)) throw createError({ statusCode: 400, statusMessage: 'Unknown error tracker' })
  await connectErrorTracking(project, { serverId: body.server, providerId: provider, team: String(body.team || '') })
  return { project: serializeAdminProject(project) }
})
