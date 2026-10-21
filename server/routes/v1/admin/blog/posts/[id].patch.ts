defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'updateBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a blog post',
    description: 'Only the keys sent change (see createBlogPost). `null` clears `excerpt` (it follows the body again), `coverImageUrl` and `publishedAt`. Publishing a post with no date dates it now; unpublishing keeps the date. Editing a live post changes the hosted page, the embed and the feed at once; a newsletter that already went out stays as it was sent.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { status: 'published', tags: ['engineering'] } } } } },
    responses: { 200: { description: 'The updated post.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/BlogPost' } } } } } }, 400: { description: 'Invalid value.' }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.blogPost(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(row.get('project')))
  await updateBlogPost(project, row, await readBody(event).catch(() => ({})))
  await row.get('newsletterCampaign')?.fetch(MASTER).catch(() => {})
  return { post: serializeBlogPost(project, row) }
})
