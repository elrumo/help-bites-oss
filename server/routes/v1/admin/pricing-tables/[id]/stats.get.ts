defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'getPricingStats', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'A pricing table\'s numbers',
    description: 'Views, unique visitors, clicks, checkouts, conversions and revenue (by currency, in the smallest unit), in total and by day, over the last `days` (default 30, up to 365), with each plan\'s clicks, checkouts and conversions. Conversions and revenue come from Stripe: completed Checkout Sessions the table started, or that came through a Payment Link it shows, checked every ten minutes (`refresh=1` asks Stripe now; the key needs read access to Checkout Sessions). `experiment` is the table\'s A/B test, when it has run one: each table\'s numbers over the run, its conversion rate, lift over the control and how sure a two-proportion test is of the difference (`confidence`, 0 to 1; `enough` is false until there are 100 visitors each and 5 conversions), and `leader` once one table is ahead with 95% confidence.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'days', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'refresh', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } }],
    responses: { 200: { description: '`{ total, days, experiment, conversions: { at, error } }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  const q = getQuery(event)
  if (q.refresh === '1') {
    const account = await findStripeAccount(project)
    if (account) await pollPricingConversions(project, account).catch(() => {})
  }
  await flushPricingStats().catch(() => 0)
  const days = Math.min(365, Math.max(1, Number(q.days) || 30))
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const { total, days: series } = await pricingFunnel(row.id || '', { since })
  setHeader(event, 'Cache-Control', 'no-store')
  return { total, days: series, experiment: await pricingExperimentReport(project, row), conversions: await pricingConversionStatus(project.id || '') }
})
