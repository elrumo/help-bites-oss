defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'publishChangelogRelease', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Publish a changelog release',
    description: 'Publishes the release (dated now, unless it already has a date) and every entry still a draft in it, dated with the release. Idempotent. The release and its entries are then public on `/v1/changelog` and the RSS feed.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The published release.', content: { 'application/json': { schema: { type: 'object', properties: { release: { '$ref': '#/components/schemas/ChangelogRelease' } } } } } }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Release not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { project, row } = await loadWriterRelease(writer, getRouterParam(event, 'id') || '')
  await publishChangelogRelease(project, row)
  return { release: serializeChangelogRelease(row) }
})
