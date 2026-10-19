defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Project overview',
    description: 'Headline numbers, setup health, what needs attention and the latest activity for one project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ stats, health, attention, activity }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return projectOverview(await requireProject(ctx, getRouterParam(event, 'id') || ''))
})
