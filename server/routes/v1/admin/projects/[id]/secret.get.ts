defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Reveal a project secret',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ secret }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  return { secret: String(project.get('secret') || '') }
})
