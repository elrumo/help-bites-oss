import { applyRevenueCatEvent } from '../../../../utils/revenue/revenuecat'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'ingestRevenueCatEvent', security: [{}],
    summary: 'Receive a RevenueCat webhook event',
    description: 'Where RevenueCat posts its events (Project settings → Integrations → Webhooks). Set the Authorization header value to the secret shown under Revenue → RevenueCat in the panel; a missing or wrong one is a 401. Purchases, renewals, refunds, cancellations and expirations update the project\'s payments and subscriptions; sandbox purchases and event types that carry no revenue answer 200 and change nothing. Answer 5xx on failure, so RevenueCat retries.',
    parameters: [{ name: 'project', in: 'path', required: true, schema: { type: 'string' }, description: 'The project id.' }],
    responses: { 200: { description: '`{ ok: true }`' }, 401: { description: 'Invalid webhook secret.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await loadProjectUnscoped(getRouterParam(event, 'project') || '').catch(() => null)
  const row = project ? await authenticateRevenueWebhook(event, project, 'revenuecat') : null
  if (!project || !row) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook secret' })
  // A suspended workspace's events are acknowledged and dropped, not retried for hours.
  if (!(await workspaceIsActive(await projectWorkspaceId(project)))) return { ok: true }
  try {
    await applyRevenueCatEvent(project, await readBody(event).catch(() => null))
    await noteRevenueEvent(row)
  } catch (error) {
    await noteRevenueEvent(row, error as Error).catch(() => {})
    throw error
  }
  return { ok: true }
})
