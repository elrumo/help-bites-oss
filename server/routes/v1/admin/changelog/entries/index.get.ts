defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'listChangelogEntries', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'List changelog entries',
    description: 'Every entry of the project, newest published first and drafts last (up to 1,000), each with the sources it links to resolved (`sources`; ones deleted since are skipped). Narrow with `status`, `release` (a release id, or `none` for entries of no release), or the entries that link one post (`feedbackPost`, id or number), board item (`boardItem`) or conversation (`conversation`).',
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator (session or `ak_` key) names it; the project secret and an admin token act on their own project' },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'published', 'archived'] }, description: 'Omit for every entry but the archived ones' },
      { name: 'release', in: 'query', schema: { type: 'string' }, description: 'Release id, or `none`' },
      { name: 'feedbackPost', in: 'query', schema: { type: 'string' }, description: 'Only entries linking this post (id or number)' },
      { name: 'boardItem', in: 'query', schema: { type: 'string' }, description: 'Only entries linking this board item id' },
      { name: 'conversation', in: 'query', schema: { type: 'string' }, description: 'Only entries linking this conversation id' }
    ],
    responses: { 200: { description: 'Entries.', content: { 'application/json': { schema: { type: 'object', properties: { entries: { type: 'array', items: { '$ref': '#/components/schemas/ChangelogEntry' } } } } } } }, 400: { description: 'Missing project.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  const query = getQuery(event)
  const filter: ChangelogEntryFilter = {}
  if (query.status === 'draft' || query.status === 'published' || query.status === 'archived') filter.status = query.status
  if (query.release) filter.release = String(query.release)
  if (query.boardItem) filter.boardItem = String(query.boardItem)
  if (query.conversation) filter.conversation = String(query.conversation)
  if (query.feedbackPost) {
    const post = await findFeedbackPost(project, String(query.feedbackPost).replace(/^#/, ''))
    if (!post) return { entries: [] }
    filter.feedbackPost = post.id
  }
  setHeader(event, 'Cache-Control', 'no-store')
  return { entries: await listChangelogEntries(project, filter) }
})
