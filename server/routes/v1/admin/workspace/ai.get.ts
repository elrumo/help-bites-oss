defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'This workspace\'s AI providers',
    description: 'The workspace\'s own OpenAI-compatible providers and which is active (keys are never returned), whether the server offers its own AI, and whether the plan allows bringing your own.',
    responses: { 200: { description: '`{ ai: { providers: [{ id, kind, name, endpoint, model, ultraModel, hasApiKey }], active }, platform: { available, metered }, allowed }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true })
  const plan = await workspacePlan(ctx.workspace)
  return {
    ai: serializeWorkspaceAi(ctx.workspace),
    platform: { available: !!gatewayEndpoint(), metered: plan.limits.aiCredits !== null },
    allowed: plan.features.byoLlm
  }
})
