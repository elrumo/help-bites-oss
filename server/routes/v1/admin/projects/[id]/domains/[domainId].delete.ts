defineRouteMeta({
  openAPI: {
    tags: ['Domains'], operationId: 'removeProjectDomain', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Remove a custom domain',
    description: 'The host stops being served at once (other replicas within a second or so). Its DNS records are yours to remove.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'domainId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'No such domain in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  await removeProjectDomain(await getProjectDomain(project, getRouterParam(event, 'domainId') || ''))
  return { ok: true }
})
