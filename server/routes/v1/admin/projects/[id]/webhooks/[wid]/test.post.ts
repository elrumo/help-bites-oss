defineRouteMeta({
  openAPI: {
    tags: ['Webhooks'], operationId: 'testWebhookEndpoint', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Send a test event',
    description: 'Queues a `webhook.test` event for this endpoint, signed and retried like a real one.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'wid', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'No such endpoint in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await getProjectEndpoint(project, getRouterParam(event, 'wid') || '')
  await rateLimit(`sb:rl:whtest:${row.id}`, 10, 60)
  await queueTestDelivery(project, row)
  return { ok: true }
})
