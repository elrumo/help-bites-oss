defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Mark a conversation read',
    operationId: 'markConversationRead',
    security: [{ EndUserToken: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' }, description: 'Conversation owned by the authenticated end user.' }],
    responses: { 200: { description: 'The updated conversation.', content: { 'application/json': { schema: { type: 'object', required: ['conversation'], properties: { conversation: { '$ref': '#/components/schemas/Conversation' } } } } } }, 404: { description: 'Conversation not found or not owned by this identity.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { endUser } = await requireEndUser(event)
  const conversation = await getConversation(getRouterParam(event, 'id') || '')
  if (!endUser || pointerId(conversation.get('endUser')) !== endUser.id) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  await markRead(conversation, 'user')
  return { conversation: await serializeConversationForEndUser(conversation) }
})
