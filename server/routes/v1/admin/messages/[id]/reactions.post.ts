import { isReactionEmoji } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'toggleAgentMessageReaction', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Toggle a tapback on a message',
    description: 'Adds the emoji as a reaction from this agent, or removes it when this agent already used it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'msg_123' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['emoji'], properties: { emoji: { type: 'string', enum: ['❤️', '👍', '👎', '😆', '❗', '❓'], example: '👍' } }, example: { emoji: '👍' } } } } },
    responses: { 200: { description: 'The message with its new reactions.', content: { 'application/json': { schema: { type: 'object', properties: { message: { '$ref': '#/components/schemas/Message' } } } } } }, 400: { description: 'Unknown emoji or message cannot carry reactions.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { agent } = ctx
  const message = await scoped.message(ctx, getRouterParam(event, 'id') || '')
  if (message.get('kind') === 'event') {
    throw createError({ statusCode: 400, statusMessage: 'This message cannot carry reactions' })
  }
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const emoji = String(payload?.emoji || '')
  if (!isReactionEmoji(emoji)) throw createError({ statusCode: 400, statusMessage: 'Unknown reaction' })
  const actorName = String(agent.get('name') || agent.get('username') || 'Agent').slice(0, 120)
  const updated = await toggleMessageReaction(message, emoji, { actor: `agent:${agent.id}`, side: 'agent', actorName })
  return { message: serializeMessage(updated) }
})
