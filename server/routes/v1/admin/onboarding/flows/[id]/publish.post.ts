defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'publishOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Publish an onboarding flow',
    description: 'Freezes the working copy into the next version and serves it at `GET /v1/onboarding/{pk}/{key}`. Apps that show a flow once per version (`data-show="update"`) show it again.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The published flow.' }, 400: { description: 'The flow has no steps.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedOnboardingFlow(ctx, event)
  await publishOnboardingFlow(row)
  return { flow: serializeOnboardingFlow(project, row) }
})
