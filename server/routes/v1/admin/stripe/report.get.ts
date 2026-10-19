import { REVENUE_RANGES, type RevenueRange } from '#shared/stripe'

defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getRevenueReport', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Revenue',
    description: 'Net revenue, MRR, subscribers, revenue by month, plans, top customers and recent payments, from the last Stripe sync. Totals are in the currency with the most revenue; others are listed in `otherCurrencies`.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'range', in: 'query', schema: { type: 'string', enum: ['30d', '90d', '12m', 'all'], default: '30d' } }],
    responses: { 200: { description: 'A revenue report.' }, 404: { description: 'Stripe is not connected.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const range = REVENUE_RANGES.find(r => r.value === query.range)?.value || '30d' as RevenueRange
  const account = await requireStripeAccount(project)
  // Nothing synced yet: an empty report instead of totals in no currency.
  if (!account.get('currency')) return { report: null }
  return { report: await revenueReport(project, account, range) }
})
