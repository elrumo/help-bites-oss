defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Messages in a conversation',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }
    ],
    responses: { 200: { description: '{ messages, hasMore }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const { before, limit } = getQuery(event)
  const { rows, hasMore } = await listMessages(conversation, typeof before === 'string' ? before : undefined, limit)
  return { messages: rows.map(serializeMessage), hasMore }
})
