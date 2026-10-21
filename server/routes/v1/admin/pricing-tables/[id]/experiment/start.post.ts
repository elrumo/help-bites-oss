defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'startPricingExperiment', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Start an A/B test',
    description: 'Splits the visitors of this table (the control) by weight between it and its variants, other published tables of the project set in `experiment.variants` (PATCH, or `POST …/variants` to make one from this table). A client that sends a `visitor` id keeps the same table for the whole run. Each start is a new run with numbers of its own, read from `GET …/stats`. Variants and weights cannot change while it runs.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ table }`' }, 400: { description: 'No variants, or a table that is not published.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  await startPricingExperiment(project, row)
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
