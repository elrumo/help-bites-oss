defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'commentOnFeedback', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Comment on a post',
    description: 'Operators and admin tokens comment as the team (`author.isTeam`). `parentId`/`replyToId` answer another comment (threads stay one level deep: a reply to a reply files under its parent). Admins may send `visibility: "internal"` for a team-only note, which neither counts nor notifies. A public comment subscribes its author, emails `@mentioned` participants and every other unmuted follower. Locked posts take comments from admins only (409).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', description: 'Markdown or HTML, up to 8,000 characters', example: 'Same here — I would use this weekly.' }, parentId: { type: 'string' }, replyToId: { type: 'string' }, visibility: { type: 'string', enum: ['public', 'internal'] } } } } } },
    responses: { 200: { description: 'The comment and the updated post.', content: { 'application/json': { schema: { type: 'object', properties: { comment: { '$ref': '#/components/schemas/FeedbackComment' }, post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 400: { description: 'Empty or too long.' }, 403: { description: 'Comments are turned off.' }, 409: { description: 'The post is locked.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  const comment = await addFeedbackComment(ctx, post, await readBody(event).catch(() => ({})))
  return { comment: serializeFeedbackComment(comment, ctx), post: await feedbackPostForViewer(ctx, post) }
})
