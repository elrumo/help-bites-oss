defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'listBlogComments', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The comments on a post',
    description: 'Visible comments, oldest first; a reply has `parentId` (replies are one level deep). Public with `?pk=`. With an identity token each comment says whether the viewer wrote it (`viewerIsAuthor`); an admin token or an operator also sees hidden ones, marked by `status`. Deleted comments are never returned. A members-only post\'s thread is for members (403 otherwise), like its body.',
    parameters: [
      { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Slug or id' },
      { name: 'pk', in: 'query', schema: { type: 'string' } },
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
    ],
    responses: { 200: { description: 'A page of comments.', content: { 'application/json': { schema: { type: 'object', properties: { comments: { type: 'array', items: { '$ref': '#/components/schemas/BlogComment' } }, total: { type: 'integer' }, hasMore: { type: 'boolean' } } } } } }, 403: { description: 'A members-only post, and the viewer is not a member.' }, 404: { description: 'Unknown project or post, or no blog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveBlogContext(event)
  setHeader(event, 'Cache-Control', optionalBearer(event) ? 'no-store' : 'public, max-age=30')
  const post = await readableBlogPost(ctx, getRouterParam(event, 'ref') || '')
  return await listBlogComments(ctx, post, readBlogCommentPage(getQuery(event)))
})
