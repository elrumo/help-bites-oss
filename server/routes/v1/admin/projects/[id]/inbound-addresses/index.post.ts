defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'addInboundAddress', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Add an address that receives mail',
    description: '`kind: "domain"` takes an `address` on a domain (or subdomain) whose MX records point at the mail provider; it is `pending` until you call verify. `kind: "forward"` makes a HelpBites alias for you to forward your own mailbox to; pass `publicAddress` (support@example.com) so replies are addressed from and to the address your customers know.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['domain', 'forward'] }, address: { type: 'string', example: 'support@mail.example.com' }, publicAddress: { type: 'string', example: 'support@example.com' }, fromName: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ address }`' }, 400: { description: 'Not an address, a reserved domain, no forwarding domain on this server, or too many addresses.' }, 402: { description: 'The plan does not include support email addresses.' }, 403: { description: 'The domain is not verified for this workspace.' }, 409: { description: 'The address belongs to another project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  return { address: serializeInboundAddress(await createInboundAddress(project, await readObjectBody(event))) }
})
