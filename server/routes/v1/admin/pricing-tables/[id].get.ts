defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'getPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get a pricing table',
    description: 'One table: its working copy, what apps get now (`published`), `warnings` and the last checkout Stripe refused (`checkoutError`).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ table }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedPricingTable(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
