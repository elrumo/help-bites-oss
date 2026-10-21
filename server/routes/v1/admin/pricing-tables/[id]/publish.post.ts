defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'publishPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Publish a pricing table',
    description: 'Freezes the working copy into the next version and serves it at `GET /v1/pricing/{pk}/{key}`. Stripe is read first, and the products, prices and payment links the table uses are kept with the version, to show while Stripe cannot be reached.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ table }`' }, 400: { description: 'The table has no plans.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  await publishPricingTable(project, row)
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
