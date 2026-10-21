defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'openPricingCheckout', security: [],
    summary: 'Go to checkout (a link)',
    description: 'The `href` of a price whose plan uses Stripe Checkout: answers `303` to a new Stripe Checkout Session for the plan\'s Stripe price, so a plain link, a button in an email or an app\'s `openURL` all work. Plans set to a Payment Link or a URL redirect there. After paying, Stripe sends the buyer to the table\'s success URL, else `return_url` (when its site is one of the project\'s allowed origins, or any while it lists none), else the project\'s site, with `?checkout=success&session_id=…`; going back adds `?checkout=canceled`. The project\'s Stripe key needs "Checkout Sessions: Write"; without it, a Payment Link for the same price is used when there is one. Each one counts as a checkout in the table\'s numbers (and its A/B test, with `exp` and `run`); the session carries the table, plan and test in its metadata (`helpbites_table`, `helpbites_plan`, `helpbites_experiment`, `helpbites_run`), which is how the purchase is counted when it completes. Errors are a short HTML page; `POST` the same URL for JSON.',
    parameters: [
      { name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'plan', in: 'query', required: true, schema: { type: 'string' }, description: 'The plan\'s key.' },
      { name: 'interval', in: 'query', required: true, schema: { type: 'string', enum: ['week', 'month', 'year', 'once'] } },
      { name: 'prefilled_email', in: 'query', required: false, schema: { type: 'string' }, description: 'Fills in the buyer\'s email.' },
      { name: 'client_reference_id', in: 'query', required: false, schema: { type: 'string' }, description: 'Your id for the buyer (letters, digits, - and _, up to 200), on the Checkout Session.' },
      { name: 'return_url', in: 'query', required: false, schema: { type: 'string' }, description: 'The page to come back to.' },
      { name: 'locale', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'currency', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'exp', in: 'query', required: false, schema: { type: 'string' }, description: 'While an A/B test runs: its table (the JSON\'s `experiment.table`), already in the `href`.' },
      { name: 'run', in: 'query', required: false, schema: { type: 'string' }, description: 'The test\'s run, already in the `href`.' },
      { name: 'visitor', in: 'query', required: false, schema: { type: 'string' } }
    ],
    responses: { 303: { description: 'To Stripe Checkout, the Payment Link or the plan\'s URL.' }, 400: { description: 'No such plan or price.' }, 404: { description: 'No such published table.' }, 409: { description: 'Stripe is not connected.' }, 429: { description: 'Too many checkouts from this address.' }, 502: { description: 'Stripe refused the session.' } }
  }
})

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  try {
    const url = await pricingCheckout(event, { plan: q.plan, interval: q.interval, email: q.prefilled_email, reference: q.client_reference_id, returnUrl: q.return_url, locale: q.locale, currency: q.currency, experiment: q.exp, run: q.run, visitor: q.visitor })
    return sendRedirect(event, url, 303)
  } catch (error) {
    // A person followed this link: they get a page, not JSON.
    const status = (error as { statusCode?: number }).statusCode || 500
    setResponseStatus(event, status)
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    const message = status === 429 ? 'Too many tries. Wait a minute and try again.' : status === 404 ? 'This plan is no longer on sale here.' : (error as { statusMessage?: string }).statusMessage || 'Something went wrong.'
    return messagePage({ name: 'Checkout', logoUrl: '', accent: '#4f46e5' }, 'Checkout is not available', message)
  }
})
