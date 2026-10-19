defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'listFeedbackComments', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'A post’s comments',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }, { name: 'pk', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'Comments, oldest first.', content: { 'application/json': { schema: { type: 'object', properties: { comments: { type: 'array', items: { '$ref': '#/components/schemas/FeedbackComment' } } } } } } }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '')
  return { comments: await listFeedbackComments(ctx, post) }
})
