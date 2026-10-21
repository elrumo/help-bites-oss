defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'createBlogComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Comment on a post',
    description: 'A signed-in user (an identity token, or an email-only session when the project allows them) comments on a published post; an operator (with `?project=`) answers as the team. `parentId` replies to a comment (a reply to a reply joins its thread). Markdown, up to 4,000 characters, rendered with a strict allowlist: no raw HTML, images or headings, at most 6 links. Five comments per ten minutes per user; the same text twice in a row on one post is a 409. 403 when comments are off for the blog or closed on the post. The blog\'s `commentNotify` addresses are emailed.',
    parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Slug or id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', maxLength: 4000 }, parentId: { type: 'string' } } } } } },
    responses: { 201: { description: 'The comment and the post\'s new visible comment count.', content: { 'application/json': { schema: { type: 'object', properties: { comment: { '$ref': '#/components/schemas/BlogComment' }, commentCount: { type: 'integer' } } } } } }, 400: { description: 'Empty, too long, or too many links.' }, 401: { description: 'Sign in to comment.' }, 403: { description: 'Comments are closed.' }, 404: { description: 'Post (or the comment replied to) not found.' }, 409: { description: 'The same text as your last comment here.' }, 429: { description: 'Too many comments.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveBlogContext(event)
  const post = await readableBlogPost(ctx, getRouterParam(event, 'ref') || '')
  const { comment, text, commentCount } = await createBlogComment(ctx, post, await readBody(event).catch(() => ({})))
  void notifyBlogComment(ctx, post, comment, text)
  setResponseStatus(event, 201)
  return { comment: serializeBlogComment(comment, blogActorId(ctx.actor)), commentCount }
})
