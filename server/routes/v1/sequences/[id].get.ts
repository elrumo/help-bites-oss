defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'getSequence', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One sequence',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ sequence }`' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  return { sequence: serializeSequence(await getProjectSequence(project, getRouterParam(event, 'id') || '')) }
})
