defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'getRoadmap', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Public roadmap',
    description: 'The project board’s public items: the ones an admin marked public whose status is planned, in progress or done (by category). Only allow-listed fields go out — the item’s `publicDescription` (never its internal description), its status, the linked posts that are not hidden and the sum of their votes; `labels` only when the board shows labels, `targetDate` only when it shows dates or uses the timeline layout. `statuses` holds the planned, active and done statuses only. Vote through the linked posts (`POST /v1/feedback/{id}/vote`); signed-in viewers get `hasVoted` per post. `?pk=` or a token, like the board. 404 unless the feedback board offers a roadmap and the project board is on.',
    parameters: [{ name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key, for anonymous reads' }, { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' }],
    responses: { 200: { description: 'The roadmap.', content: { 'application/json': { schema: { type: 'object', properties: { options: { type: 'object', properties: { layout: { type: 'string', enum: ['columns', 'timeline', 'list'] }, showLabels: { type: 'boolean' }, showDates: { type: 'boolean' } } }, statuses: { type: 'array', items: { type: 'object' } }, labels: { type: 'array', items: { type: 'object' }, description: 'Only when the board shows labels' }, items: { type: 'array', items: { '$ref': '#/components/schemas/RoadmapItem' } } } } } } }, 401: { description: 'Neither a public key nor a token.' }, 404: { description: 'Unknown project, or no public roadmap.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event)
  const board = getBoardConfig(ctx.project)
  if (!ctx.config.roadmap || !board.enabled) throw createError({ statusCode: 404, statusMessage: 'This project has no public roadmap' })
  return await listRoadmap(ctx, board)
})
