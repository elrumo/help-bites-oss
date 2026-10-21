defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'deleteBlogComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a comment',
    description: 'Its author, or a moderator (an admin token or an operator). The words go; replies to it stay.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'The post\'s new visible comment count.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean' }, commentCount: { type: 'integer' } } } } } }, 401: { description: 'Sign in.' }, 403: { description: 'Not yours to delete.' }, 404: { description: 'Comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const found = await getBlogComment(getRouterParam(event, 'id') || '')
  const ctx = await resolveBlogContext(event, { projectId: pointerId(found.row.get('project')) })
  const comment = await loadBlogComment(found.row.id || '', ctx.project.id || '')
  return { deleted: true, commentCount: await deleteBlogComment(ctx, comment) }
})
