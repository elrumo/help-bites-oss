import { BLOG_COMMENT_STATUSES, type BlogCommentStatus } from '#shared/blog'

defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'listProjectBlogComments', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Moderate the blog\'s comments',
    description: 'The comments on every post of the project, newest first, each with the post it is on: visible and hidden ones unless `status` narrows it. Hide or show one with PATCH /v1/blog/comments/{id} `{ status }`, take it down with DELETE, and answer with POST /v1/blog/{ref}/comments: an operator\'s comment is marked as the team\'s.',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['visible', 'hidden', 'deleted'] } },
      { name: 'post', in: 'query', schema: { type: 'string' }, description: 'Only the comments on this post (id or slug)' },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
    ],
    responses: { 200: { description: '`{ comments, total, hasMore }`; each comment also has `postTitle` and `postSlug`.', content: { 'application/json': { schema: { type: 'object', properties: { comments: { type: 'array', items: { '$ref': '#/components/schemas/BlogComment' } }, total: { type: 'integer' }, hasMore: { type: 'boolean' } } } } } }, 404: { description: 'Project or post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await blogProject(ctx, event)
  const query = getQuery(event)
  if (query.status !== undefined && !(BLOG_COMMENT_STATUSES as readonly string[]).includes(String(query.status))) throw createError({ statusCode: 400, statusMessage: `status must be one of ${BLOG_COMMENT_STATUSES.join(', ')}` })
  let postId: string | undefined
  if (query.post) {
    const post = await findBlogPost(project, String(query.post))
    if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
    postId = post.id
  }
  setHeader(event, 'Cache-Control', 'no-store')
  return await listProjectBlogComments(project, { status: query.status as BlogCommentStatus | undefined, postId }, readBlogCommentPage(query))
})
