defineRouteMeta({
  openAPI: {
    tags: ['Webhooks'], operationId: 'listWebhookDeliveries', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Recent webhook deliveries',
    description: 'The latest deliveries across the project, or one endpoint\'s with `endpoint=`; newest first.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'endpoint', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }],
    responses: { 200: { description: '`{ deliveries }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const query = getQuery(event)
  return { deliveries: await recentDeliveries(project, String(query.endpoint || ''), Number(query.limit) || 30) }
})
