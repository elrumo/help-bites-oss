defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'deleteChangelogRelease', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Delete a changelog release',
    description: 'Removes the release. Its entries stay, as entries of no release (a published one is then public on its own).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Release not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { project, row } = await loadWriterRelease(writer, getRouterParam(event, 'id') || '')
  await deleteChangelogRelease(project, row)
  return { deleted: true }
})
