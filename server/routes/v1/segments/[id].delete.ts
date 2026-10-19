defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'deleteSegment', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a segment',
    description: 'The contacts stay. Campaigns already sent keep their numbers; a scheduled campaign aimed at it is refused when it starts.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ deleted: true }`' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const row = await getProjectSegment(project, getRouterParam(event, 'id') || '')
  await row.destroy(MASTER)
  return { deleted: true }
})
