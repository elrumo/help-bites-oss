defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'updateFeedbackComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a comment',
    description: 'Its author changes `body` (while the board allows user edits; stamps `editedAt`). Admins may also set `visibility`: `public`, `internal` (a team-only note) or `hidden` (moderated away). Only public comments count or notify.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }, { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string' }, visibility: { type: 'string', enum: ['public', 'internal', 'hidden'] } } } } } },
    responses: { 200: { description: 'The comment and the post (with its new comment count).', content: { 'application/json': { schema: { type: 'object', properties: { comment: { '$ref': '#/components/schemas/FeedbackComment' }, post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 400: { description: 'Invalid value.' }, 403: { description: 'Not yours to edit.' }, 404: { description: 'Post or comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  const comment = await updateFeedbackComment(ctx, post, getRouterParam(event, 'commentId') || '', await readBody(event).catch(() => ({})))
  return { comment: serializeFeedbackComment(comment, ctx), post: await feedbackPostForViewer(ctx, post) }
})
