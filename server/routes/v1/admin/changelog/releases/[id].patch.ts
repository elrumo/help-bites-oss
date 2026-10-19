defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'updateChangelogRelease', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Edit a changelog release',
    description: 'Updates only the fields sent. Setting `status` to `published` here publishes the release itself; use publishChangelogRelease to also publish its draft entries. Setting it back to `draft` hides the whole release again.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { title: 'Autumn release' } } } } },
    responses: { 200: { description: 'The updated release.', content: { 'application/json': { schema: { type: 'object', properties: { release: { '$ref': '#/components/schemas/ChangelogRelease' } } } } } }, 400: { description: 'Invalid value.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Release not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { row } = await loadWriterRelease(writer, getRouterParam(event, 'id') || '')
  await updateChangelogRelease(row, await readBody(event).catch(() => ({})))
  return { release: serializeChangelogRelease(row) }
})
