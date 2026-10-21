defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'deleteBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a blog post',
    description: 'Removes the post, its comments and its reactions. A newsletter it went out as stays under Campaigns with its numbers. Deleting a public post sends the `blog.post.deleted` event webhook.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.blogPost(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(row.get('project')))
  await deleteBlogPost(project, row)
  return { deleted: true }
})
