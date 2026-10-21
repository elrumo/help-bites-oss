defineRouteMeta({
  openAPI: {
    tags: ['Webhooks'], operationId: 'updateWebhookEndpoint', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Change a webhook endpoint',
    description: 'Any of `url`, `description`, `events`, `enabled`. Send `rotateSecret: true` for a new signing secret (returned once).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'wid', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ endpoint }`' }, 404: { description: 'No such endpoint in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await getProjectEndpoint(project, getRouterParam(event, 'wid') || '')
  const body = await readObjectBody(event)
  applyEndpointInput(row, body)
  if (body.rotateSecret === true) await rotateEndpointSecret(row)
  else await row.save(null, MASTER)
  return { endpoint: serializeWebhookEndpoint(row, body.rotateSecret === true) }
})
