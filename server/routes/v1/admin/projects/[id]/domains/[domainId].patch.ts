defineRouteMeta({
  openAPI: {
    tags: ['Domains'], operationId: 'updateProjectDomain', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Change what a custom domain shows',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'domainId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['target'], properties: { target: { type: 'string', enum: ['hub', 'feedback', 'roadmap', 'changelog', 'blog'] } } } } } },
    responses: { 200: { description: '`{ domain }`' }, 400: { description: 'Unknown target.' }, 404: { description: 'No such domain in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await getProjectDomain(project, getRouterParam(event, 'domainId') || '')
  await setDomainTarget(row, (await readObjectBody(event)).target)
  return { domain: serializeProjectDomain(row) }
})
