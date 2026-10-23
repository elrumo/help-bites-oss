import { REVENUE_RANGES, type RevenueRange } from '#shared/stripe'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'getRevenue', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Revenue',
    description: 'Net revenue, MRR, subscribers, net revenue and MRR (at each month end) for the last 12 months, plans, top customers and recent payments, over every connected source, with `sources` saying what each brought in the period. Totals are in the currency with the most revenue; others are listed in `otherCurrencies`. `report` is null until something has been paid.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'range', in: 'query', schema: { type: 'string', enum: ['30d', '90d', '12m', 'all'], default: '30d' } }],
    responses: { 200: { description: '`{ report }`' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const range = REVENUE_RANGES.find(r => r.value === query.range)?.value || '30d' as RevenueRange
  setHeader(event, 'Cache-Control', 'no-store')
  return { report: await revenueReport(project, range) }
})
