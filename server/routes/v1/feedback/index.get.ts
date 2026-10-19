defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'listFeedback', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a feedback board',
    description: 'Public: pass the project public key as `?pk=` (or `X-Project-Key`) to read anonymously, or an identity token to also get `hasVoted`/`isMine`/`canEdit` per post. Operators pass `?project=<id>`. Hidden posts are only returned to admins (operators, or tokens with `role: "admin"`) that ask for `includeHidden`. `view=roadmap` keeps planned/active/done statuses; `view=changelog` keeps done posts marked `showOnChangelog`, newest completion first (deprecated: the public changelog is made of changelog entries now, read it with `GET /v1/changelog`).',
    parameters: [
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key, for anonymous reads' },
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' },
      { name: 'view', in: 'query', schema: { type: 'string', enum: ['board', 'roadmap', 'changelog'] } },
      { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma-separated status keys' },
      { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Comma-separated status categories: open, planned, active, done, closed' },
      { name: 'type', in: 'query', schema: { type: 'string' }, description: 'Comma-separated type keys' },
      { name: 'platform', in: 'query', schema: { type: 'string' }, description: 'Comma-separated platform keys' },
      { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Comma-separated tag keys; a post matches when it has any of them' },
      { name: 'subscribed', in: 'query', schema: { type: 'boolean' }, description: 'Only posts the signed-in user follows' },
      { name: 'featured', in: 'query', schema: { type: 'boolean' } },
      { name: 'mine', in: 'query', schema: { type: 'boolean' }, description: 'Only the signed-in user’s posts' },
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive match on title and text' },
      { name: 'sort', in: 'query', schema: { type: 'string', enum: ['top', 'new', 'activity', 'completed'] } },
      { name: 'includeHidden', in: 'query', schema: { type: 'boolean' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500, default: 100 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
    ],
    responses: { 200: { description: 'Posts, the total matching count, and who the board thinks you are.', content: { 'application/json': { schema: { type: 'object', properties: { posts: { type: 'array', items: { '$ref': '#/components/schemas/FeedbackPost' } }, total: { type: 'integer', example: 42 }, viewer: { '$ref': '#/components/schemas/FeedbackViewer' } } } } } }, 401: { description: 'Neither a public key nor a token.' }, 404: { description: 'Unknown project, or the board is not enabled.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event)
  const { posts, total } = await listFeedbackPosts(ctx, readFeedbackListQuery(getQuery(event), ctx.config))
  return { posts, total, viewer: feedbackViewer(ctx.actor) }
})
