defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'deleteFeedbackComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a comment',
    description: 'Its author or an admin.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }, { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted; the post carries the new comment count.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean' }, post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 403: { description: 'Not yours to delete.' }, 404: { description: 'Post or comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  await deleteFeedbackComment(ctx, post, getRouterParam(event, 'commentId') || '')
  return { deleted: true, post: await feedbackPostForViewer(ctx, post) }
})
