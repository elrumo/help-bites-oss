defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'previewPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Preview a pricing table',
    description: 'The table as apps would get it with the changes in the body applied (a `PATCH` body, or nothing for the working copy as saved), with Stripe\'s current prices. Nothing is saved, and the buttons carry no checkout links. `previewLocale` and `previewCurrency` pick the language and currency to show.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { previewLocale: { type: 'string' }, previewCurrency: { type: 'string' } }, additionalProperties: true } } } },
    responses: { 200: { description: '`{ preview }`: the public shape of `GET /v1/pricing/{pk}/{key}`.' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedPricingTable(ctx, event)
  const catalog = await projectCatalog(project)
  return { preview: await previewPricingTable(project, row, (await readBody(event).catch(() => ({}))) || {}, catalog.catalog) }
})
