defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'deleteContactSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Stop syncing from a database',
    description: 'Deletes the source and its stored credential. The contacts it brought in stay.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ deleted: true }`' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  assertSession(ctx)
  const project = await requireProject(ctx, String(getQuery(event).project || ''))
  const row = await getProjectSource(project, getRouterParam(event, 'id') || '')
  await row.destroy(MASTER)
  return { deleted: true }
})
