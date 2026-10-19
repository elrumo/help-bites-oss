defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Open or close a conversation',
    description: 'Sets a status configured for this conversation type.',
    operationId: 'setConversationStatus',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', description: 'A status key configured on this conversation’s type.', example: 'reviewing' } }, example: { status: 'reviewing' } } } } },
    responses: { 200: { description: 'Updated conversation; a `status.changed` event is appended to its timeline.', content: { 'application/json': { schema: { type: 'object', properties: { conversation: { '$ref': '#/components/schemas/Conversation' } } } } } }, 400: { description: 'Missing or unknown status.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const { status } = (await readBody(event).catch(() => ({}))) as { status?: string }
  if (!status || typeof status !== 'string') throw createError({ statusCode: 400, statusMessage: 'status is required' })
  await setStatus(conversation, status)
  return { conversation: serializeConversation(conversation) }
})
