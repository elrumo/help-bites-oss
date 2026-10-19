defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'createChangelogRelease', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Create a changelog release',
    description: 'A release is a version that groups entries. It starts as a draft: nothing in it is public until the release is published (see publishChangelogRelease).',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator (session or `ak_` key) names it; the project secret and an admin token act on their own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['version'], properties: {
      version: { type: 'string', description: 'Free text, up to 60 characters', example: '2.4' },
      title: { type: 'string', description: 'Optional headline, up to 200 characters' },
      summary: { type: 'string', description: 'Optional intro, up to 2,000 characters' },
      status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
      publishedAt: { type: 'string', format: 'date-time', nullable: true }
    } } } } },
    responses: { 200: { description: 'The created release.', content: { 'application/json': { schema: { type: 'object', properties: { release: { '$ref': '#/components/schemas/ChangelogRelease' } } } } } }, 400: { description: 'Missing version, or an invalid status or date.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  const row = await createChangelogRelease(project, await readBody(event).catch(() => ({})))
  return { release: serializeChangelogRelease(row) }
})
