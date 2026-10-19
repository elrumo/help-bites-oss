defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'updateSegment', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Rename a segment or change its filter',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, filter: { type: 'object' }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ segment }`' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const row = await getProjectSegment(project, getRouterParam(event, 'id') || '')
  if (typeof body.name === 'string' && body.name.trim()) row.set('name', body.name.trim().slice(0, 80))
  if (body.filter !== undefined) row.set('filter', readSegmentFilter(body.filter))
  await row.save(null, MASTER)
  return { segment: serializeSegment(row) }
})
