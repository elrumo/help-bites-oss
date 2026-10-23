defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'removeInboundAddress', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Stop receiving mail at an address',
    description: 'Mail sent to it afterwards is dropped. Conversations already made from it stay.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'addressId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'No such address in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  await removeInboundAddress(await getInboundAddress(project, getRouterParam(event, 'addressId') || ''))
  return { ok: true }
})
