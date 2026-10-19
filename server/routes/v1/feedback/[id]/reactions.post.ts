defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'reactToFeedback', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'React to a post',
    description: 'One of `+1`, `-1`, `laugh`, `hooray`, `confused`, `heart`, `rocket`, `eyes`. Send `{ "key": "rocket" }` to toggle, or add `"reacted": true|false` to set it (safe to retry). Reactions are not votes. Locked posts take reactions from admins only (409).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['key'], properties: { key: { type: 'string', enum: ['+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'] }, reacted: { type: 'boolean' } } } } } },
    responses: { 200: { description: 'The post with its reactions.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 400: { description: 'Unknown reaction.' }, 409: { description: 'The post is locked.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown> | null
  const row = await reactToFeedback(ctx, post, post, body?.key, typeof body?.reacted === 'boolean' ? body.reacted : undefined)
  return { post: await feedbackPostForViewer(ctx, row) }
})
