defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Delete a conversation',
    description: 'Permanently removes the conversation and all of its messages, for the customer too. Archive it instead to keep the history.',
    operationId: 'deleteConversation',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    responses: { 200: { description: '`{ deleted: true }`' }, 404: { description: 'Conversation not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  await deleteConversation(conversation)
  return { deleted: true }
})
