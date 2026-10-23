import { ingestCustom } from '../../../../utils/revenue/custom'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'sendRevenue', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Send payments and subscriptions',
    description: 'Adds payments and subscriptions HelpBites has no connector for (Google Play earnings, Gumroad, PayPal, an invoice sent by hand) to the project\'s revenue, as the `custom` source (connected on first use). Up to 500 of each per request. `id` is yours and makes sending safe to repeat: the same id updates its row. Amounts are decimals in the currency\'s units (19.99), not cents. A payment: `{ id, amount, currency, paidAt?, email?, customerId?, description?, status? (succeeded counts), refunded?, receiptUrl? }`. A subscription: `{ id, plan, amount, currency, interval (day|week|month|year), intervalCount?, status (active, trialing, past_due, paused, canceled…), email?, customerId?, startedAt?, canceledAt?, endedAt? }`; only active and past_due count towards MRR. Dates are ISO 8601 or epoch seconds. A customer is matched to a contact by `email`, or by `customerId` equal to the contact\'s external id.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, payments: { type: 'array', items: { type: 'object' } }, subscriptions: { type: 'array', items: { type: 'object' } } } } } } },
    responses: { 200: { description: '`{ saved: { payments, subscriptions } }`' }, 400: { description: 'A row is invalid; the message names it.' } }
  }
})

export default defineEventHandler(async (event) => {
  // `marketing`, not `projects.manage`: a key limited to this project may send its own revenue.
  const ctx = await requireMember(event, { can: 'marketing' })
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const row = (await findRevenueSource(project, 'custom')) || await connectRevenueSource(project, 'custom', {})
  const saved = await ingestCustom(project.id || '', body)
  await noteRevenueEvent(row)
  return { saved }
})
