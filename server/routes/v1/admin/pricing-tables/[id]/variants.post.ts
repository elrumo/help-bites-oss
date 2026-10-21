defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'addPricingVariant', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Add an A/B test variant',
    description: 'Copies this table\'s working copy into a new draft table (key `<key>-b`, `-c`, `-d` unless you send `key`) and adds it to this table\'s test with the control\'s weight. Edit and publish it like any table, then start the test. A test has at most three variants.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { key: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ table, variant }`: this table and the new one.' }, 400: { description: 'Three variants already, or a key that is taken.' }, 404: { description: 'Not found.' }, 409: { description: 'The test is running.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  const variant = await addPricingVariant(project, row, (await readBody(event).catch(() => ({}))) || {})
  const catalog = await projectCatalog(project)
  return { table: await serializePricingTable(project, row, catalog, event), variant: await serializePricingTable(project, variant, catalog, event) }
})
