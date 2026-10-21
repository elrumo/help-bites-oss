defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'deleteOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete an onboarding flow',
    description: 'Apps that ask for it get a 404 from then on; apps that cached it keep showing their copy until they next reach HelpBites.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedOnboardingFlow(ctx, event)
  await row.destroy(MASTER)
  return { ok: true }
})
