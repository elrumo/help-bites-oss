defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getStripeCatalog', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Stripe products and prices',
    description: 'The project\'s active Stripe products (with their marketing features and unit label), prices (amounts in the currency\'s smallest unit, with any other currencies they sell in) and payment links, as pricing tables use them. Read through the project\'s Stripe key and kept for five minutes; `refresh=1` asks Stripe now. `paymentLinks` is false when the key cannot read payment links. `connected: false` without Stripe.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'refresh', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } }],
    responses: { 200: { description: '`{ connected, catalog, paymentLinks, error }`' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, String(getQuery(event).project || ''))
  const { connected, catalog, paymentLinks, error } = await projectCatalog(project, { refresh: getQuery(event).refresh === '1' })
  setHeader(event, 'Cache-Control', 'no-store')
  return { connected, catalog, paymentLinks, error }
})
