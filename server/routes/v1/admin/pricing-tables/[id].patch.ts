defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'updatePricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a pricing table',
    description: [
      'Only the keys sent change. `plans` and `features` are full lists, in order (an item without an `id` is new). `content`, `style`, `options` and `checkout` merge key by key.',
      'A plan: `key`, `name` and `description` (empty uses the Stripe product\'s), `badge`, `highlighted`, `stripeProduct` (`prod_…`), `prices` with a slot each for `month`, `year` and `once` (`{ stripePrice: "price_…" or "" for the product\'s current price, amount: 19.99 written by hand or null, appStoreProduct }`), `customPrice` (shown when it has no price, "Custom"), `priceNote`, `trialDays`, `action` (`{ type: checkout | payment_link | url | none, label, url }`) and `features`: by feature id, `true`, `false` or a short value ("10", "Unlimited").',
      'A feature row: `{ id, kind: feature | heading, text, hint }`. `locale` is the language the copy is written in; `translations` is `{ "es": { "plans/<id>/name": "…", "features/<id>/text": "…" } }` with the keys `GET …` lists in `texts`: a language you send replaces that language and `null` removes it.',
      'Edits change the working copy only: apps keep the published version until you publish again. Prices linked to Stripe are read live, so changing them in Stripe needs no publish.'
    ].join(' '),
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { name: 'Pricing', template: 'tiers', plans: [{ id: 'pl_1', key: 'pro', name: 'Pro', badge: 'Most popular', highlighted: true, stripeProduct: 'prod_ABC123', prices: { month: { stripePrice: '', amount: null, appStoreProduct: 'com.acme.pro.monthly' }, year: { stripePrice: '', amount: null, appStoreProduct: 'com.acme.pro.yearly' }, once: { stripePrice: '', amount: null, appStoreProduct: '' } }, trialDays: 14, action: { type: 'checkout', label: 'Start free trial' }, features: { ft_1: '10', ft_2: true } }], features: [{ id: 'ft_1', kind: 'feature', text: 'Projects', hint: '' }, { id: 'ft_2', kind: 'feature', text: 'Priority support', hint: 'Answered within a day' }], style: { radius: 12, highlight: 'raise' }, options: { defaultInterval: 'year', cumulative: true } } } } } },
    responses: { 200: { description: '`{ table }`' }, 400: { description: 'Invalid value; every problem is listed.' }, 404: { description: 'Not found.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  await updatePricingTable(project, row, (await readBody(event).catch(() => ({}))) || {})
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
