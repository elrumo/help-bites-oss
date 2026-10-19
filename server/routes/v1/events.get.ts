defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Live events (SSE)',
    description: 'Server-sent events for the signed-in end user\'s conversations: `message.created`, `message.deleted`, `conversation.updated`, plus `ping` every 25 s. Each `data` line is the JSON event with the serialized message/conversation. Send the token in the Authorization header (use fetch + ReadableStream, not EventSource).',
    operationId: 'streamEndUserEvents',
    security: [{ EndUserToken: [] }],
    responses: { 200: { description: 'An indefinitely-open `text/event-stream` response. Example: `event: message.created\\ndata: {"type":"message.created","message":{"id":"msg_123"}}\\n\\n`.', content: { 'text/event-stream': { schema: { type: 'string', example: 'event: message.created\ndata: {"type":"message.created","message":{"id":"msg_123"}}\n' } } } } }
  }
})

export default defineEventHandler(async (event) => {
  // Ensure the row exists: a widget subscribes before its user has written anything.
  const { endUser, projectId } = await requireEndUser(event, { ensure: true })
  const endUserId = endUser?.id || ''
  return streamProjectEvents(event, projectId, e => e.audience !== 'agent' && e.projectId === projectId && e.endUserId === endUserId, endUserEvent)
})
