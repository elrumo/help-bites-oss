defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'getFeedback', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One post with its comments',
    description: 'Readable like the list: `?pk=` or a token. Hidden posts are 404 for everyone but admins, and so are team notes (`internal`) and moderated (`hidden`) comments. `linked` resolves the `#N` references in the post and its comments; `backrefs` lists the posts that reference this one.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }, { name: 'pk', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'The post, its comments oldest first, and the viewer.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/FeedbackPost' }, comments: { type: 'array', items: { '$ref': '#/components/schemas/FeedbackComment' } }, viewer: { '$ref': '#/components/schemas/FeedbackViewer' }, linked: { type: 'array', items: { '$ref': '#/components/schemas/FeedbackPostRef' } }, backrefs: { type: 'array', items: { '$ref': '#/components/schemas/FeedbackPostRef' } } } } } } }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '')
  const comments = await listFeedbackComments(ctx, post)
  const { linked, backrefs } = await feedbackLinks(ctx, post, comments)
  return { post: await feedbackPostForViewer(ctx, post), comments, viewer: feedbackViewer(ctx.actor), linked, backrefs }
})
