defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'reviewChangelogEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Approve or reject a draft entry',
    description: 'Only drafts are reviewed. **Approve** publishes the entry (it keeps a `publishedAt` it already has, otherwise it gets now) and marks it `approved`. **Reject** leaves it a draft marked `rejected`, with your notes, for its author to revise. Both record who reviewed and when. An entry whose release is still a draft stays hidden until the release is published.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry id, slug, or number with `?project=`' }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['approve', 'reject'] }, notes: { type: 'string', description: 'Up to 2000 characters' } } } } } },
    responses: { 200: { description: 'The reviewed entry.', content: { 'application/json': { schema: { type: 'object', properties: { entry: { '$ref': '#/components/schemas/ChangelogEntry' } } } } } }, 400: { description: 'Not a draft, or no valid action.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Entry not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { project, row } = await loadWriterEntry(event, writer, getRouterParam(event, 'id') || '')
  await reviewChangelogEntry(row, writer, await readBody(event).catch(() => ({})))
  return { entry: await serializeChangelogEntry(project, row) }
})
