defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'reactToFeedbackComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'React to a comment',
    description: 'Same as reacting to a post: send `{ "key": "heart" }` to toggle, or add `reacted` to set it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }, { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['key'], properties: { key: { type: 'string', enum: ['+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'] }, reacted: { type: 'boolean' } } } } } },
    responses: { 200: { description: 'The comment with its reactions.', content: { 'application/json': { schema: { type: 'object', properties: { comment: { '$ref': '#/components/schemas/FeedbackComment' } } } } } }, 400: { description: 'Unknown reaction.' }, 404: { description: 'Post or comment not found.' }, 409: { description: 'The post is locked.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  const target = await new (useParse()).Query('FeedbackComment').equalTo('post', post).equalTo('objectId', getRouterParam(event, 'commentId') || '').first(MASTER)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown> | null
  const comment = await reactToFeedback(ctx, post, target, body?.key, typeof body?.reacted === 'boolean' ? body.reacted : undefined)
  return { comment: serializeFeedbackComment(comment, ctx) }
})
