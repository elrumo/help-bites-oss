defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'updateBlogComment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit or moderate a comment',
    description: 'Two operations that must not be confused. `body` is the author editing their own words (a moderator cannot rewrite what someone said); the comment then shows as edited. `status` (`visible` or `hidden`) is moderation, for an admin token or an operator.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string', maxLength: 4000 }, status: { type: 'string', enum: ['visible', 'hidden'] } } } } } },
    responses: { 200: { description: 'The comment, and the post\'s visible count when `status` changed it.', content: { 'application/json': { schema: { type: 'object', properties: { comment: { '$ref': '#/components/schemas/BlogComment' }, commentCount: { type: 'integer', nullable: true } } } } } }, 400: { description: 'Nothing to change, or an unusable body.' }, 401: { description: 'Sign in.' }, 403: { description: 'Not the author (for `body`) or not an admin (for `status`).' }, 404: { description: 'Comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const found = await getBlogComment(getRouterParam(event, 'id') || '')
  const ctx = await resolveBlogContext(event, { projectId: pointerId(found.row.get('project')) })
  const comment = await loadBlogComment(found.row.id || '', ctx.project.id || '')
  const { commentCount } = await patchBlogComment(ctx, comment, await readBody(event).catch(() => ({})))
  return { comment: serializeBlogComment(comment.row, blogActorId(ctx.actor)), commentCount }
})
