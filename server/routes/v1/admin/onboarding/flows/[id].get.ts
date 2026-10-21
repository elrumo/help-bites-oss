defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'getOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get an onboarding flow',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The flow.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedOnboardingFlow(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { flow: serializeOnboardingFlow(project, row) }
})
