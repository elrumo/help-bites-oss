import { can } from '#shared/roles'

defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'listRevenueSources', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Connected revenue sources',
    description: 'The project\'s revenue sources (Stripe, RevenueCat, Apple, Paddle, Lemon Squeezy, custom) that are connected, Stripe first, with how each one\'s last run went and how many payments and subscriptions it brought. A push source (RevenueCat) also returns `webhook.url`, and `webhook.token`, the secret its Authorization header must carry, only to members who can manage the project. Credentials are never returned.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ sources: RevenueConnection[] }`' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, String(getQuery(event).project || ''))
  setHeader(event, 'Cache-Control', 'no-store')
  return { sources: await listRevenueSources(project, { event, withSecret: can(ctx.role, 'projects.manage') }) }
})
