defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'listPricingTables', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List pricing tables',
    description: 'Every pricing table of the project, drafts included, each with its working copy (plans, features, content, style, options, checkout, translations), `published`: what apps get now with Stripe\'s current prices (null while it is a draft), `changed` when the working copy differs from it, and `warnings`: buttons that go nowhere, prices Stripe no longer has.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ tables, stripe: { connected, error } }`' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await pricingProject(ctx, event)
  const catalog = await projectCatalog(project)
  setHeader(event, 'Cache-Control', 'no-store')
  const rows = await listPricingTables(project)
  return { tables: await Promise.all(rows.map(row => serializePricingTable(project, row, catalog, event))), stripe: { connected: catalog.connected, error: catalog.error } }
})
