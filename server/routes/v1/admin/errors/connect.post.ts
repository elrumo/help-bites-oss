defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Connect a project to an error tracker', operationId: 'connectErrorTracking', security: [{ AgentSession: [] }, { AdminApiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, provider: { type: 'string', enum: ['glitchtip', 'bugsink'], default: 'glitchtip' } } } } } }, responses: { 200: { description: '`{ project }`' }, 409: { description: 'Already connected to the other tracker.' }, 501: { description: 'That tracker is not configured on the server.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = (await readBody(event).catch(() => ({}))) as { project?: string, provider?: string }
  const project = await requireProject(ctx, String(body.project || ''))
  const provider = body.provider || 'glitchtip'
  if (!isErrorProvider(provider)) throw createError({ statusCode: 400, statusMessage: 'Unknown error tracker' })
  await connectErrorTracking(project, provider)
  return { project: serializeAdminProject(project) }
})
