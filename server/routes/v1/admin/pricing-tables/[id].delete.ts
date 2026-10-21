defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'deletePricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a pricing table',
    description: 'Apps that ask for it get a 404 from then on, and its checkout links stop working. Nothing in Stripe changes.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { row } = await scopedPricingTable(ctx, event)
  await row.destroy(MASTER)
  return { ok: true }
})
