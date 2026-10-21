defineRouteMeta({
  openAPI: {
    tags: ['Webhooks'], operationId: 'deleteWebhookEndpoint', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Remove a webhook endpoint',
    description: 'Deliveries still waiting for it are dropped.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'wid', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'No such endpoint in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await getProjectEndpoint(project, getRouterParam(event, 'wid') || '')
  await dropPendingDeliveries(row)
  await row.destroy(MASTER)
  return { ok: true }
})
