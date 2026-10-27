defineRouteMeta({
  openAPI: {
    tags: ['Stripe'], operationId: 'disconnectStripe', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Disconnect Stripe',
    description: 'Forgets the key and the payments and subscriptions synced from Stripe. Contacts keep their `stripe_*` attributes.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ disconnected: true }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  await disconnectStripe(await requireProject(ctx, String(getQuery(event).project || '')))
  return { disconnected: true }
})
