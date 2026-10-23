import { INBOUND_ADDRESS_LIMIT } from '#shared/inboundEmail'

defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'listInboundAddresses', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List the addresses a project receives mail at',
    description: 'Mail sent to one of these becomes a conversation in the inbox. `forwardingDomain` is the domain forwarding aliases are made on (empty when the server offers none).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ addresses, limit, forwardingDomain }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  return { addresses: (await listInboundAddresses(project)).map(serializeInboundAddress), limit: INBOUND_ADDRESS_LIMIT, forwardingDomain: inboundDomain() }
})
