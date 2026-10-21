defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'unpublishOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Unpublish an onboarding flow',
    description: 'The public URL answers 404, and the web script drops its cached copy when it sees that. The version number is kept, so the next publish counts on from it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The flow, now a draft.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedOnboardingFlow(ctx, event)
  await unpublishOnboardingFlow(row)
  return { flow: serializeOnboardingFlow(project, row) }
})
