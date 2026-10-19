defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'listConversationMessages', security: [{ EndUserToken: [] }],
    summary: 'Messages in a conversation',
    description: 'Oldest first. Page backwards with `before` (an ISO timestamp from the oldest message you have). Bearer: identity token.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'before', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 200 } }
    ],
    responses: { 200: { description: 'Public timeline only, oldest first.', content: { 'application/json': { schema: { type: 'object', properties: { conversation: { '$ref': '#/components/schemas/Conversation' }, messages: { type: 'array', items: { '$ref': '#/components/schemas/Message' } }, hasMore: { type: 'boolean' } } } } } }, 404: { description: 'Not owned by this identity token.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { endUser } = await requireEndUser(event)
  const conversation = await getConversation(getRouterParam(event, 'id') || '')
  if (!endUser || pointerId(conversation.get('endUser')) !== endUser.id) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

  const { before, limit } = getQuery(event)
  const { rows, hasMore } = await listMessages(conversation, typeof before === 'string' ? before : undefined, limit, true)
  return { conversation: await serializeConversationForEndUser(conversation), messages: rows.map(serializeMessage), hasMore }
})
