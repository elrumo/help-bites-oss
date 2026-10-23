defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getContactBilling', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'A contact\'s Stripe customer, subscriptions and payments',
    description: 'The customer is read from Stripe live, by the contact\'s `stripe_customer` attribute or else their email (Stripe matches email case-sensitively); it is null when there is none, Stripe is not connected or Stripe does not answer. Subscriptions and payments are those of every revenue source, found by the Stripe customer id, the app\'s user id (`externalId`) or the email, from the hourly sync and the sources that push.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'contact', in: 'query', required: true, schema: { type: 'string' }, description: 'The contact id.' }],
    responses: { 200: { description: '`{ currency, customer, subscriptions, payments }` (newest first); empty when the contact has no billing rows.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const billing = await contactBilling(project, await findStripeAccount(project), await getProjectContact(project, String(query.contact || '')))
  return { currency: await primaryCurrency(project.id || ''), ...billing }
})
