defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'unpublishPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Unpublish a pricing table',
    description: 'Back to a draft: the public URL and its checkout links answer 404, and onboarding steps that show it show their text only.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ table }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  await unpublishPricingTable(row)
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
