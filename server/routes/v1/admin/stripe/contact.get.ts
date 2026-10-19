defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getContactBilling', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'A contact\'s subscriptions and payments',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'contact', in: 'query', required: true, schema: { type: 'string' }, description: 'The contact id.' }],
    responses: { 200: { description: '`{ currency, subscriptions, payments }` (newest first); empty when Stripe is not connected.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const account = await findStripeAccount(project)
  if (!account) return { currency: '', subscriptions: [], payments: [] }
  return { currency: String(account.get('currency') || ''), ...await contactBilling(project, await getProjectContact(project, String(query.contact || ''))) }
})
