defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'deleteChangelogComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a changelog comment',
    description: 'By its author, an admin token or an operator. The words go (that is what taking one down means) and the comment stops being returned; the row stays for the audit trail.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' }],
    responses: { 200: { description: 'Deleted, and the entry’s new visible comment count.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean' }, commentCount: { type: 'integer' } } } } } }, 401: { description: 'Sign in.' }, 403: { description: 'Not the author or an admin.' }, 404: { description: 'Comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveCommentContext(event)
  const comment = await loadChangelogComment(getRouterParam(event, 'id') || '', ctx.project.id || '')
  return { deleted: true, commentCount: await deleteChangelogComment(ctx, comment) }
})
