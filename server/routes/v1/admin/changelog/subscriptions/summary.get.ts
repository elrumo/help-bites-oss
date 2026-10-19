defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'getChangelogSubscribers', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'How many people the changelog emails',
    description: 'Counts only, never addresses: active subscribers by cadence, pending (unconfirmed) and unsubscribed.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the secret and an admin token act on their own project' }],
    responses: { 200: { description: 'Counts.', content: { 'application/json': { schema: { type: 'object', properties: { instant: { type: 'integer' }, weekly: { type: 'integer' }, pending: { type: 'integer' }, unsubscribed: { type: 'integer' } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  setHeader(event, 'Cache-Control', 'no-store')
  return await countChangelogSubscribers(project)
})
