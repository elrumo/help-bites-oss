defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Archive or unarchive a conversation',
    description: 'Archived conversations leave the inbox queue but keep their history. A new message from the customer unarchives the thread.',
    operationId: 'archiveConversation',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { archived: { type: 'boolean', default: true } } } } } },
    responses: { 200: { description: 'Updated conversation.', content: { 'application/json': { schema: { type: 'object', properties: { conversation: { '$ref': '#/components/schemas/Conversation' } } } } } }, 404: { description: 'Conversation not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  // readBody resolves `undefined` for an empty body: no body means "archive".
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as { archived?: boolean }
  await setArchived(conversation, body.archived !== false)
  return { conversation: serializeConversation(conversation) }
})
