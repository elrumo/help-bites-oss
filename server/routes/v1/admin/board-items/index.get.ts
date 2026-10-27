defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'listBoardItems', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a project board',
    description: 'Every item on the project board in rank order (up to 1,000), with its linked feedback posts and conversations resolved. Links whose post or conversation was deleted are skipped. `voteCount` sums the votes of the linked posts that are not hidden. Narrow to the items linked to one conversation or one post with `conversation` or `feedbackPost`.',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' },
      { name: 'conversation', in: 'query', schema: { type: 'string' }, description: 'Only items linked to this conversation id' },
      { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Only items in this status key' },
      { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Page size; omit for every item' },
      { name: 'offset', in: 'query', schema: { type: 'integer' }, description: 'Items to skip' },
      { name: 'feedbackPost', in: 'query', schema: { type: 'string' }, description: 'Only items linked to this post (id or number)' }
    ],
    responses: { 200: { description: 'Items, in rank order.', content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'integer' }, items: { type: 'array', items: { '$ref': '#/components/schemas/BoardItem' } } } } } } }, 400: { description: 'Missing project.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project not found.' } }
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
    if (!post) return { total: 0, items: [] }
    filter.feedbackPost = post.id
  }
  let items = await listBoardItems(project, filter)
  if (query.status) items = items.filter(item => item.status === String(query.status))
  const total = items.length
  const offset = Math.max(0, Number(query.offset) || 0)
  const limit = Number(query.limit) > 0 ? Number(query.limit) : total
  return { total, items: items.slice(offset, offset + limit) }
})
