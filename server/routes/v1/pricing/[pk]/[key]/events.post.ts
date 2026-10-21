defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'countPricingEvent', security: [],
    summary: 'Count a view or a click',
    description: 'What pricing.js and the Swift snippet send so the table\'s numbers and A/B tests have views, unique visitors and clicks: `type` is `view` (the table was shown) or `click` (a plan\'s button was pressed, with `plan` and `interval`). `key` is the table that was shown (the `key` of its JSON); `visitor` is an id your client keeps for the person (6 to 64 letters, digits, - and _); `experiment` and `run` are the JSON\'s `experiment.table` and `experiment.run` while a test runs. JSON, or the same as `text/plain` (what `navigator.sendBeacon` sends). Always `204`, so a page never waits on it; checkouts and purchases are counted by HelpBites and Stripe themselves.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['view', 'click'] }, visitor: { type: 'string' }, plan: { type: 'string' }, interval: { type: 'string' }, experiment: { type: 'string' }, run: { type: 'string' } } }, example: { type: 'click', visitor: 'v_8f2c1d4e', plan: 'pro', interval: 'year' } } } },
    responses: { 204: { description: 'Counted (or ignored).' }, 404: { description: 'No such published table.' }, 429: { description: 'Too many events from this address.' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:pricingevents:${clientIp(event) || 'ip'}`, LIMITS.pricingEventsPerIp.limit, LIMITS.pricingEventsPerIp.window)
  const raw = await readRawBody(event).catch(() => '')
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(String(raw || '{}')) } catch {}
  const { project, row, published } = await findPublishedPricingTable(getRouterParam(event, 'pk') || '', getRouterParam(event, 'key') || '')
  const type = body.type === 'view' ? 'views' : body.type === 'click' ? 'clicks' : null
  setResponseStatus(event, 204)
  if (!type) return null
  const plan = typeof body.plan === 'string' ? published.snapshot.plans.find(p => p.key === body.plan)?.key : undefined
  const experiment = await namedExperiment(project, String(row.get('key')), body.experiment, body.run)
  await countPricing(project.id || '', row.id || '', experiment?.run || '', { [type]: 1 }, { plan, visitor: readVisitor(body.visitor) || undefined })
  return null
})
