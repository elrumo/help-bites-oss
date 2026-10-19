defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'syncStripe', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Sync Stripe now',
    description: 'Starts a run in the background (poll the connection for `status`). Runs also happen hourly. `reset: true` reads every charge again, to pick up refunds on old payments.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, reset: { type: 'boolean' } } } } } },
    responses: { 200: { description: '`{ connection }` (status running)' }, 404: { description: 'Stripe is not connected.' }, 409: { description: 'A run is already going.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const body = await readObjectBody(event)
  const row = await requireStripeAccount(await requireProject(ctx, String(body.project || '')))
  if (row.get('status') === 'running' && row.updatedAt && Date.now() - row.updatedAt.getTime() < 120_000) throw createError({ statusCode: 409, statusMessage: 'A sync is already running' })
  row.set('status', 'running')
  await row.save(null, MASTER)
  void runStripeSync(row.id || '', { reset: body.reset === true }).catch(error => console.error('[stripe] run failed:', (error as Error).message))
  return { connection: serializeStripeAccount(row) }
})
