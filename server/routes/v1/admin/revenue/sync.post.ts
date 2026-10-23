import { isRevenueSource, revenueSource } from '#shared/revenue'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'syncRevenueSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Sync a revenue source now',
    description: 'Starts a run in the background (poll the sources for `status`) for a source HelpBites reads: Stripe, Apple, Paddle or Lemon Squeezy. Runs also happen hourly. `reset: true` reads the whole history again, to pick up changes to old payments. RevenueCat and custom are not read: they send.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'source'], properties: { project: { type: 'string' }, source: { type: 'string' }, reset: { type: 'boolean' } } } } } },
    responses: { 200: { description: '`{ connection }` (status running)' }, 400: { description: 'A source that is not read by HelpBites.' }, 404: { description: 'The source is not connected.' }, 409: { description: 'A run is already going.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const source = String(body.source || '')
  if (!isRevenueSource(source)) throw createError({ statusCode: 400, statusMessage: 'Unknown revenue source' })
  if (source !== 'stripe' && revenueSource(source)?.kind !== 'pull') throw createError({ statusCode: 400, statusMessage: 'This source sends its data to HelpBites; there is nothing to sync' })
  const row = source === 'stripe' ? await requireStripeAccount(project) : await requireRevenueSource(project, source)
  if (row.get('status') === 'running' && row.updatedAt && Date.now() - row.updatedAt.getTime() < 120_000) throw createError({ statusCode: 409, statusMessage: 'A sync is already running' })
  row.set('status', 'running')
  await row.save(null, MASTER)
  const reset = body.reset === true
  void (source === 'stripe' ? runStripeSync(row.id || '', { reset }) : runRevenueSync(row.id || '', { reset })).catch(error => console.error(`[${source}] run failed:`, (error as Error).message))
  return { connection: (await listRevenueSources(project, { event })).find(c => c.source === source) }
})
