defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Project overview',
    description: 'Headline numbers, the setup checklist (see `GET /v1/admin/projects/{id}/setup`), what needs attention (the same kinds as `GET /v1/admin/attention`, plus unread conversations) and the latest activity for one project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ stats, setup, attention, activity }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return projectOverview(ctx, await requireProject(ctx, getRouterParam(event, 'id') || ''))
})
