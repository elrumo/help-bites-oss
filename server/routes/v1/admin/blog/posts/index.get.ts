import { BLOG_POST_STATUSES, type BlogPostStatus } from '#shared/blog'

defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'listBlogPosts', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List blog posts',
    description: 'Every post of the project for the team: drafts first, then published posts newest first (up to 1,000). Without `body` and `bodyHtml`: read one post for those. A published post whose `publishedAt` is still ahead is scheduled (`live: false`).',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'published'] } },
      { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Only posts with this tag (any case)' }
    ],
    responses: { 200: { description: 'Posts.', content: { 'application/json': { schema: { type: 'object', properties: { posts: { type: 'array', items: { '$ref': '#/components/schemas/BlogPost' } } } } } } }, 400: { description: 'Missing project, or an unknown status.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await blogProject(ctx, event)
  const query = getQuery(event)
  if (query.status !== undefined && !(BLOG_POST_STATUSES as readonly string[]).includes(String(query.status))) throw createError({ statusCode: 400, statusMessage: `status must be one of ${BLOG_POST_STATUSES.join(', ')}` })
  setHeader(event, 'Cache-Control', 'no-store')
  const rows = await listBlogPosts(project, { status: query.status as BlogPostStatus | undefined, tag: query.tag ? String(query.tag) : undefined })
  return { posts: rows.map(row => serializeBlogPost(project, row)) }
})
