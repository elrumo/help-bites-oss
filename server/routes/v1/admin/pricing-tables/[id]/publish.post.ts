defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'publishPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Publish a pricing table',
    description: 'Freezes the working copy into the next version and serves it at `GET /v1/pricing/{pk}/{key}`. Stripe is read first, and the products, prices and payment links the table uses are kept with the version, to show while Stripe cannot be reached. Send `{ \"force\": true }` to publish again even when nothing changed and to re-read Stripe now instead of from its short cache. Answers of `GET /v1/pricing/{pk}/{key}` may still sit in a visitor\'s browser or a CDN for up to a minute (the server itself holds no copy).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ table }`' }, 400: { description: 'The table has no plans.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  const body = await readBody(event).catch(() => null)
  if (body?.force === true) await projectCatalog(project, { refresh: true, wait: true }).catch(() => null)
  await publishPricingTable(project, row)
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
