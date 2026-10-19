defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'getStripeConnection', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Is Stripe connected?',
    description: 'The project\'s Stripe connection and how its last sync went. The key is never returned.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ connection }`.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, String(getQuery(event).project || ''))
  return { connection: serializeStripeAccount(await findStripeAccount(project)) }
})
