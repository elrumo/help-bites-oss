defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'deleteFeedback', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a post',
    description: 'Its author or an admin. Removes its votes and comments too.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 403: { description: 'Not yours to delete.' }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  await deleteFeedbackPost(ctx, post)
  return { deleted: true }
})
