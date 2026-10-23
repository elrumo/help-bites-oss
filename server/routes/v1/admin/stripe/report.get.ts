import { REVENUE_RANGES, type RevenueRange } from '#shared/stripe'

defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getRevenueReport', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Revenue',
    description: 'Net revenue, MRR, subscribers, net revenue and MRR (at each month end) for the last 12 months, plans, top customers and recent payments, from the last Stripe sync. Totals are in the currency with the most revenue; others are listed in `otherCurrencies`.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'range', in: 'query', schema: { type: 'string', enum: ['30d', '90d', '12m', 'all'], default: '30d' } }],
    responses: { 200: { description: 'A revenue report.' }, 404: { description: 'Stripe is not connected.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const range = REVENUE_RANGES.find(r => r.value === query.range)?.value || '30d' as RevenueRange
  await requireStripeAccount(project)
  // Nothing synced yet: no report instead of totals in no currency. Covers every source, like /v1/admin/revenue/report.
  return { report: await revenueReport(project, range) }
})
