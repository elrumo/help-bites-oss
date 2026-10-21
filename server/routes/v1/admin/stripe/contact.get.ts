defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getContactBilling', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'A contact\'s Stripe customer, subscriptions and payments',
    description: 'The customer is read from Stripe live, by the contact\'s `stripe_customer` attribute or else their email (Stripe matches email case-sensitively); it is null when there is none or Stripe does not answer. Subscriptions and payments come from the hourly sync.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'contact', in: 'query', required: true, schema: { type: 'string' }, description: 'The contact id.' }],
    responses: { 200: { description: '`{ currency, customer, subscriptions, payments }` (newest first); empty when Stripe is not connected.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const account = await findStripeAccount(project)
  if (!account) return { currency: '', customer: null, subscriptions: [], payments: [] }
  return { currency: String(account.get('currency') || ''), ...await contactBilling(project, account, await getProjectContact(project, String(query.contact || ''))) }
})
