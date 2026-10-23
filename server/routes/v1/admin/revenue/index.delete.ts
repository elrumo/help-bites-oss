import { isRevenueSource } from '#shared/revenue'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'disconnectRevenueSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Disconnect a revenue source',
    description: 'Forgets the source\'s credentials and the payments and subscriptions it brought (the other sources\' are kept). For `custom` that deletes what you sent. Contacts keep their `stripe_*` attributes.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'source', in: 'query', required: true, schema: { type: 'string', enum: ['stripe', 'revenuecat', 'apple', 'paddle', 'lemonsqueezy', 'custom'] } }],
    responses: { 200: { description: '`{ disconnected: true }`' }, 400: { description: 'Unknown source.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const source = String(query.source || '')
  if (!isRevenueSource(source)) throw createError({ statusCode: 400, statusMessage: 'Unknown revenue source' })
  await (source === 'stripe' ? disconnectStripe(project) : disconnectRevenueSource(project, source))
  return { disconnected: true }
})
