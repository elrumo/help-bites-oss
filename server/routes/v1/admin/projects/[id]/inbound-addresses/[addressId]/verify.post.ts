defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'verifyInboundAddress', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Check an address\'s MX records',
    description: 'For a `domain` address: looks up the domain\'s MX records and marks the address `verified` when they point at the mail provider (otherwise `failed`). A forwarding alias has nothing to check. At most 10 checks a minute.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'addressId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ address }`' }, 404: { description: 'No such address in this project.' }, 429: { description: 'Too many checks.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await getInboundAddress(project, getRouterParam(event, 'addressId') || '')
  return { address: serializeInboundAddress(await verifyInboundAddress(row)) }
})
