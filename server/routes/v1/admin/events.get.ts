defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Live events for the inbox (SSE)',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Limit to one project id' }],
    responses: { 200: { description: 'text/event-stream' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { project } = getQuery(event)
  if (typeof project === 'string' && project) {
    const projectId = (await requireProject(ctx, project)).id || ''
    return streamProjectEvents(event, projectId, e => e.projectId === projectId)
  }
  return streamWorkspaceEvents(event, ctx.workspaceId, e => e.workspaceId === ctx.workspaceId && (!ctx.apiKeyProjectIds || ctx.apiKeyProjectIds.includes(e.projectId)))
})
