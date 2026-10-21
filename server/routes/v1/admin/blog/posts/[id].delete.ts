defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'deleteBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a blog post',
    description: 'Removes the post, its comments and its reactions. A newsletter it went out as stays under Campaigns with its numbers.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 404: { description: 'Post not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.blogPost(ctx, getRouterParam(event, 'id') || '')
  await deleteBlogPost(row)
  return { deleted: true }
})
