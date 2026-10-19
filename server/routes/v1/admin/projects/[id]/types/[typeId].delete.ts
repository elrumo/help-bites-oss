defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Delete an unused conversation type', operationId: 'deleteConversationType', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Only types with no conversations can be deleted. The built-in `support` type cannot be deleted.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'project_123' } }, { name: 'typeId', in: 'path', required: true, schema: { type: 'string', example: 'type_123' } }], responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 409: { description: 'Type is used by conversations.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const type = await new (useParse()).Query('ConversationType').get(getRouterParam(event, 'typeId') || '', MASTER).catch(() => null)
  if (!type || pointerId(type.get('project')) !== project.id) throw createError({ statusCode: 404, statusMessage: 'Conversation type not found' })
  if (type.get('key') === 'support') throw createError({ statusCode: 400, statusMessage: 'The built-in support type cannot be deleted' })
  const inUse = await new (useParse()).Query('Conversation').equalTo('project', project).equalTo('type', type.get('key')).first(MASTER)
  if (inUse) throw createError({ statusCode: 409, statusMessage: 'Cannot delete a type used by conversations' })
  await type.destroy(MASTER)
  return { deleted: true }
})
