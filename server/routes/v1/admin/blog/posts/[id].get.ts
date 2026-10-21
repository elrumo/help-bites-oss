defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'getBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Read a blog post',
    description: 'One post with its Markdown `body` and rendered `bodyHtml`, drafts included.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The post.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/BlogPost' } } } } } }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.blogPost(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(row.get('project')))
  await row.get('newsletterCampaign')?.fetch(MASTER).catch(() => {})
  setHeader(event, 'Cache-Control', 'no-store')
  return { post: serializeBlogPost(project, row) }
})
