defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'listChangelogReleases', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'List changelog releases',
    description: 'Every release of the project, newest first, drafts included. A release groups entries (`releaseId` on an entry) under a version.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator (session or `ak_` key) names it; the project secret and an admin token act on their own project' }],
    responses: { 200: { description: 'Releases.', content: { 'application/json': { schema: { type: 'object', properties: { releases: { type: 'array', items: { '$ref': '#/components/schemas/ChangelogRelease' } } } } } } }, 400: { description: 'Missing project.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  setHeader(event, 'Cache-Control', 'no-store')
  return { releases: await listChangelogReleases(project) }
})
