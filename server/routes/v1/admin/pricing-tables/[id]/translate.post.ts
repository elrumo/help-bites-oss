defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'translatePricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Translate a pricing table with AI',
    description: 'Translates the working copy (name, title, plans, features, values, buttons, small print) from its own language (`locale`) into each language in `locales`, and saves the result in `translations`. Prices and numbers are left as they are. Strings that already have a translation are kept unless `overwrite` is true. Apps see it after the next publish. Uses the workspace\'s AI provider, or the server\'s gateway (metered in AI credits).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['locales'], properties: { locales: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Language tags such as `es`, `fr`, `pt-BR`.' }, overwrite: { type: 'boolean' } }, example: { locales: ['es', 'fr'] } } } } },
    responses: { 200: { description: '`{ table }` with its new translations.' }, 400: { description: 'No languages, or nothing to translate.' }, 404: { description: 'Not found.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI provider answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  await translatePricingTable(ctx, row, (await readBody(event).catch(() => ({}))) || {})
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
