defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'updateChangelogEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Edit a changelog entry',
    description: 'Updates only the fields sent (see createChangelogEntry); `null` clears `body`, `publishedAt` and `releaseId`. The first time an entry is published it gets `publishedAt` now; unpublishing keeps the date.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry id, or its number with `?project=`' }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { status: 'published', releaseId: 'r1' } } } } },
    responses: { 200: { description: 'The updated entry.', content: { 'application/json': { schema: { type: 'object', properties: { entry: { '$ref': '#/components/schemas/ChangelogEntry' } } } } } }, 400: { description: 'Invalid value.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Entry or release not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { project, row } = await loadWriterEntry(event, writer, getRouterParam(event, 'id') || '')
  await updateChangelogEntry(project, row, await readBody(event).catch(() => ({})))
  return { entry: await serializeChangelogEntry(project, row) }
})
