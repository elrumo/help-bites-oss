defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'deleteChangelogEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Delete a changelog entry',
    description: 'Removes the entry and its links. The linked posts, board items and conversations stay.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Entry not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { row } = await loadWriterEntry(event, writer, getRouterParam(event, 'id') || '')
  await deleteChangelogEntry(row)
  return { deleted: true }
})
