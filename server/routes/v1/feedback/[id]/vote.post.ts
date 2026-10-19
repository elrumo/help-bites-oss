defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'voteFeedback', security: [{ EndUserToken: [] }],
    summary: 'Vote, or take a vote back',
    description: 'Send `{ "voted": true }` or `{ "voted": false }` to set the vote (safe to retry); send nothing to toggle. Votes close once a post is in a done or closed status (409).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { voted: { type: 'boolean' } }, example: { voted: true } } } } },
    responses: { 200: { description: 'The post with its new count and whether you now vote for it.', content: { 'application/json': { schema: { type: 'object', properties: { voted: { type: 'boolean' }, post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 401: { description: 'Sign in to vote.' }, 409: { description: 'Voting is closed for this post.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown> | null
  const want = typeof body?.voted === 'boolean' ? body.voted : undefined
  const voted = await voteOnFeedbackPost(ctx, post, want)
  return { voted, post: await feedbackPostForViewer(ctx, post) }
})
