defineRouteMeta({
  openAPI: {
    tags: ['Webhooks'], operationId: 'listWebhookEndpoints', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a project\'s webhook endpoints',
    description: 'Each endpoint has its own signing secret and an event filter (`*`, `group.*` or an exact type; see the event list in docs/EVENTS.md). The project\'s original single event webhook is not listed here; it keeps its four events.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ endpoints }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  return { endpoints: (await listProjectEndpoints(project)).map(row => serializeWebhookEndpoint(row)) }
})
