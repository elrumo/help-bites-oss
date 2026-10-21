defineRouteMeta({
  openAPI: {
    tags: ['Webhooks'], operationId: 'createWebhookEndpoint', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Add a webhook endpoint',
    description: 'Posts the events matching `events` (default everything) to `url`, signed with `x-helpbites-signature: sha256=<hmac of the body>`. The signing `secret` is returned once, here.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, description: { type: 'string' }, events: { type: 'array', items: { type: 'string' } }, enabled: { type: 'boolean' } } }, example: { url: 'https://example.com/hooks/helpbites', events: ['changelog.entry.published', 'feedback.*'] } } } },
    responses: { 200: { description: '`{ endpoint }` with `secret`' }, 400: { description: 'Bad URL or unknown event.' }, 402: { description: 'The plan does not include event webhooks.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await createEndpoint(project, await readObjectBody(event))
  return { endpoint: serializeWebhookEndpoint(row, true) }
})
