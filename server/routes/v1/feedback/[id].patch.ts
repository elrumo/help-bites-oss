defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'updateFeedback', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a post',
    description: 'Authors may change `title`, `body`, `type`, `platform`, `tags` and `attachments` while the board allows user edits (changed words, or the author re-filing it, stamp `editedAt`). Admins may change everything, including `status` — moving into a status marked `notify` emails the post’s followers, and the first move into a done status stamps `completedAt` — `locked`, `adminNote`, `shippedIn` and `pinnedCommentId` (a public, top-level comment). Send `null` to clear an optional value.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { status: 'in-progress', featured: true } } } } },
    responses: { 200: { description: 'The updated post.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 400: { description: 'Invalid value.' }, 403: { description: 'Not yours to edit.' }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  await updateFeedbackPost(ctx, post, await readBody(event).catch(() => ({})))
  return { post: await feedbackPostForViewer(ctx, post) }
})
