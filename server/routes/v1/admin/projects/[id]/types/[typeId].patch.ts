defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Update a conversation type', operationId: 'updateConversationType', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Partial update using the same shape as create. Existing conversations retain their stored status/fields; do not remove a status or field still needed for historical interpretation.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'project_123' } }, { name: 'typeId', in: 'path', required: true, schema: { type: 'string', example: 'type_123' } }], requestBody: { content: { 'application/json': { schema: { '$ref': '#/components/schemas/ConversationType' } } } }, responses: { 200: { description: 'Updated type.', content: { 'application/json': { schema: { type: 'object', properties: { type: { '$ref': '#/components/schemas/ConversationType' } } } } } }, 400: { description: 'Invalid type definition.' }, 404: { description: 'Project or type not found.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const type = await new (useParse()).Query('ConversationType').get(getRouterParam(event, 'typeId') || '', MASTER).catch(() => null)
  if (!type || pointerId(type.get('project')) !== project.id) throw createError({ statusCode: 404, statusMessage: 'Conversation type not found' })
  applyConversationTypeInput(type, (await readBody(event).catch(() => ({}))) as Record<string, unknown>)
  await type.save(null, MASTER)
  return { type: serializeConversationType(type) }
})
