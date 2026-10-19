defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'mergeFeedback', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Merge a duplicate into another post (admins)',
    description: 'Moves this post’s votes onto `into` (each voter counts once), copies its followers, links it as `duplicateOf`, locks it, and moves it to `status` — by default the board’s first closed status, which notifies followers when that status is marked `notify`. `into` is an id, number or externalId. `{ "into": null }` removes the link; moved votes stay where they went.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['into'], properties: { into: { type: 'string', nullable: true, example: '12' }, status: { type: 'string' } } } } } },
    responses: { 200: { description: 'Both posts.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/FeedbackPost' }, into: { '$ref': '#/components/schemas/FeedbackPost', description: 'null after unlinking' } } } } } }, 400: { description: 'Merging into itself or into a duplicate.' }, 403: { description: 'Admins only.' }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  const { post: merged, into } = await mergeFeedbackDuplicate(ctx, post, await readBody(event).catch(() => ({})))
  return { post: await feedbackPostForViewer(ctx, merged), into: into ? await feedbackPostForViewer(ctx, into) : null }
})
