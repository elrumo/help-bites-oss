defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'suggestPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Suggest copy, features and prices with AI',
    description: 'Reads the project\'s connected GitHub repos (read-only, three at most: `repos` names them, else all), the table\'s working copy, its Stripe products, prices and the last 90 days of revenue by plan, and the table\'s own numbers, and proposes plan names and descriptions, a feature list with each plan\'s values, and prices. `focus` limits it to `copy`, `features` and/or `prices` (default all three); `notes` is anything you want it to know (up to 1,000 characters). Nothing is saved: `draft` is what to apply (send it as a `PATCH`), `preview` the proposal as apps would get it. Plans linked to Stripe keep their links; a different price for one comes back as `advice`. Uses the workspace\'s AI provider, or the server\'s gateway (metered in AI credits).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { focus: { type: 'array', items: { type: 'string', enum: ['copy', 'features', 'prices'] } }, repos: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }, example: { focus: ['copy', 'features'], notes: 'Most customers are solo developers; teams ask for SSO.' } } } },
    responses: { 200: { description: '`{ suggestion: { summary, advice, draft: { content, plans, features }, preview, repos } }`' }, 400: { description: 'Nothing to go on: no repos, no notes and no plans.' }, 404: { description: 'Not found.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI provider answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  return { suggestion: await suggestPricing(ctx, project, row, (await readBody(event).catch(() => ({}))) || {}) }
})
