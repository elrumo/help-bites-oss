defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'listBoardItems', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a project board',
    description: 'Every item on the project board in rank order (up to 1,000), with its linked feedback posts and conversations resolved. Links whose post or conversation was deleted are skipped. `voteCount` sums the votes of the linked posts that are not hidden. Narrow to the items linked to one conversation or one post with `conversation` or `feedbackPost`.',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' },
      { name: 'conversation', in: 'query', schema: { type: 'string' }, description: 'Only items linked to this conversation id' },
      { name: 'feedbackPost', in: 'query', schema: { type: 'string' }, description: 'Only items linked to this post (id or number)' }
    ],
    responses: { 200: { description: 'Items, in rank order.', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { '$ref': '#/components/schemas/BoardItem' } } } } } } }, 400: { description: 'Missing project.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const projectId = String(query.project || '')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  const project = await requireProject(ctx, projectId)
  const filter: { conversation?: string, feedbackPost?: string } = {}
  if (query.conversation) filter.conversation = String(query.conversation)
  if (query.feedbackPost) {
    const post = await findFeedbackPost(project, String(query.feedbackPost).replace(/^#/, ''))
    if (!post) return { items: [] }
    filter.feedbackPost = post.id
  }
  return { items: await listBoardItems(project, filter) }
})
