import { isReactionEmoji } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'toggleEndUserMessageReaction', security: [{ EndUserToken: [] }],
    summary: 'Toggle a tapback on a message',
    description: 'Adds the emoji as a reaction from this identity, or removes it when this identity already used it. React to any public message in one of your conversations.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'msg_123' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['emoji'], properties: { emoji: { type: 'string', enum: ['❤️', '👍', '👎', '😆', '❗', '❓'], example: '❤️' } }, example: { emoji: '❤️' } } } } },
    responses: { 200: { description: 'The message with its new reactions.', content: { 'application/json': { schema: { type: 'object', properties: { message: { '$ref': '#/components/schemas/Message' } } } } } }, 400: { description: 'Unknown emoji or message cannot carry reactions.' }, 404: { description: 'Not yours or not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { endUser, claims } = await requireEndUser(event, { ensure: true, write: true })
  const message = await getMessage(getRouterParam(event, 'id') || '')
  const conversation = await getConversation(pointerId(message.get('conversation')))
  if (!endUser || pointerId(conversation.get('endUser')) !== endUser.id) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  }
  if (message.get('kind') === 'event' || message.get('visibility') === 'internal') {
    throw createError({ statusCode: 400, statusMessage: 'This message cannot carry reactions' })
  }
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const emoji = String(payload?.emoji || '')
  if (!isReactionEmoji(emoji)) throw createError({ statusCode: 400, statusMessage: 'Unknown reaction' })
  const updated = await toggleMessageReaction(message, emoji, { actor: 'user', side: 'user', actorName: endUserDisplayName(endUser, claims) })
  return { message: serializeMessage(updated) }
})
