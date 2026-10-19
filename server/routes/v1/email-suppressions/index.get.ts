defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'listEmailSuppressions', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Addresses the project no longer mails',
    description: 'Hard bounces and spam complaints (added by the delivery webhook), unsubscribes, and addresses added by hand or by API. Sends skip them unless they pass `ignoreSuppressions`.',
    parameters: [
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'The start of an address.' },
      { name: 'reason', in: 'query', schema: { type: 'string', enum: ['bounce', 'complaint', 'unsubscribe', 'manual'] } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } }
    ],
    responses: { 200: { description: '`{ suppressions: [{ id, email, reason, detail, source, createdAt }], nextBefore }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const query = getQuery(event)
  const before = query.before ? new Date(String(query.before)) : undefined
  if (before && Number.isNaN(before.getTime())) throw createError({ statusCode: 400, statusMessage: 'before must be an ISO date' })
  return listEmailSuppressions(project, { q: String(query.q || ''), reason: String(query.reason || ''), limit: Number(query.limit) || 100, before })
})
