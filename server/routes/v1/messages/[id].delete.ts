defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Unsend one of your messages',
    operationId: 'deleteEndUserMessage',
    security: [{ EndUserToken: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'msg_123' }, description: 'A public message sent by this identity.' }],
    responses: { 200: { description: 'Message removed and conversation counters recomputed.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 404: { description: 'Not yours or not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { endUser } = await requireEndUser(event)
  const message = await getMessage(getRouterParam(event, 'id') || '')
  const conversation = await getConversation(pointerId(message.get('conversation')))
  if (!endUser || message.get('sender') !== 'user' || pointerId(conversation.get('endUser')) !== endUser.id) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }
  await deleteMessage(message)
  return { deleted: true }
})
