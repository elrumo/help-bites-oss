defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'connectStripe', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Connect Stripe',
    description: 'Checks the key and starts the first sync. Use a restricted key (`rk_live_…`) with read access to Charges, Customers, Subscriptions and Products (and Payment Links, for pricing tables that link to them). HelpBites writes nothing to Stripe, except a Checkout Session when someone presses the button of a pricing table set to Stripe Checkout, and only if you also give the key "Checkout Sessions: Write". The key is stored sealed when the server has HELPBITES_SECRET.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'apiKey'], properties: { project: { type: 'string' }, apiKey: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ connection }`' }, 400: { description: 'Not a Stripe key.' }, 502: { description: 'Stripe refused the key or lacks read access.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const row = await connectStripe(project, body.apiKey)
  // The first stretch runs now; the worker continues it if there is more.
  void runStripeSync(row.id || '').catch(error => console.error('[stripe] run failed:', (error as Error).message))
  return { connection: serializeStripeAccount(row) }
})
