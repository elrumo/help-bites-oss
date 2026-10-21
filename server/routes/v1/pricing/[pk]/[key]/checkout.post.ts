defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'createPricingCheckout', security: [],
    summary: 'Start a checkout',
    description: 'The JSON form of `GET …/checkout`: answers `{ url }`, where to send the buyer (a new Stripe Checkout Session, or the plan\'s Payment Link or URL). Open to any origin, no secret: the project\'s public key. `clientReferenceId` is not verified (anyone can send any); match purchases to your users in a Stripe webhook by the email or the session\'s metadata (`helpbites_table`, `helpbites_plan`) and your own checks.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['plan', 'interval'], properties: { plan: { type: 'string' }, interval: { type: 'string', enum: ['week', 'month', 'year', 'once'] }, email: { type: 'string' }, clientReferenceId: { type: 'string' }, returnUrl: { type: 'string' }, locale: { type: 'string' }, currency: { type: 'string' }, experiment: { type: 'string', description: 'The JSON\'s `experiment.table` while an A/B test runs.' }, run: { type: 'string', description: 'The JSON\'s `experiment.run`.' }, visitor: { type: 'string' } } }, example: { plan: 'pro', interval: 'year', email: 'ada@example.com', returnUrl: 'https://acme.test/pricing' } } } },
    responses: { 200: { description: '`{ url }`' }, 400: { description: 'No such plan or price.' }, 404: { description: 'No such published table.' }, 409: { description: 'Stripe is not connected.' }, 429: { description: 'Too many checkouts from this address.' }, 502: { description: 'Stripe refused the session.' } }
  }
})

export default defineEventHandler(async (event) => {
  const body = await readObjectBody(event)
  const url = await pricingCheckout(event, { plan: body.plan, interval: body.interval, email: body.email, reference: body.clientReferenceId, returnUrl: body.returnUrl, locale: body.locale, currency: body.currency, experiment: body.experiment, run: body.run, visitor: body.visitor })
  return { url }
})
