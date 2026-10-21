defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'listOnboardingFlows', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List onboarding flows',
    description: 'Every onboarding flow of the project, drafts included, each with its working steps, style and options, and `published`: what apps get now (null while it is a draft). `changed` is true when the working copy differs from the published one.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: 'Flows.' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await onboardingProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { flows: (await listOnboardingFlows(project)).map(row => serializeOnboardingFlow(project, row)) }
})
