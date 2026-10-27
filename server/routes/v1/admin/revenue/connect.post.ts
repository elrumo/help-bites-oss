import { isRevenueSource, revenueSource } from '#shared/revenue'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'connectRevenueSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Connect a revenue source',
    description: 'Connects one of `stripe`, `revenuecat`, `apple`, `paddle`, `lemonsqueezy` or `custom`. `credentials` holds what the source asks for: `apiKey` for Stripe (a restricted `rk_…` key with read access), Paddle and Lemon Squeezy; `issuerId`, `keyId`, `vendorNumber` and `privateKey` (the .p8 text) for Apple. RevenueCat and custom need none. A source that HelpBites reads is tried first (502 when the service refuses the credentials) and its first run starts at once. RevenueCat returns the `webhook` to paste into its dashboard; connecting it again keeps the same secret. Credentials are stored sealed when the server has HELPBITES_SECRET.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'source'], properties: { project: { type: 'string' }, source: { type: 'string', enum: ['stripe', 'revenuecat', 'apple', 'paddle', 'lemonsqueezy', 'custom'] }, credentials: { type: 'object', additionalProperties: { type: 'string' } } } } } } },
    responses: { 200: { description: '`{ connection }`' }, 400: { description: 'Unknown source or missing credentials.' }, 502: { description: 'The service refused the credentials.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const source = String(body.source || '')
  if (!isRevenueSource(source)) throw createError({ statusCode: 400, statusMessage: 'Unknown revenue source' })
  const credentials = (body.credentials && typeof body.credentials === 'object' ? body.credentials : {}) as Record<string, unknown>
  if (source === 'stripe') {
    const row = await connectStripe(project, credentials.apiKey)
    // The first stretch runs now; the worker continues it if there is more.
    void runStripeSync(row.id || '').catch(error => console.error('[stripe] run failed:', (error as Error).message))
  } else {
    const row = await connectRevenueSource(project, source, credentials)
    if (revenueSource(source)?.kind === 'pull') void runRevenueSync(row.id || '').catch(error => console.error('[revenue] run failed:', (error as Error).message))
  }
  return { connection: (await listRevenueSources(project, { event, withSecret: true })).find(c => c.source === source) }
})
