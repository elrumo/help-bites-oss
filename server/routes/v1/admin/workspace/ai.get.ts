defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'This workspace\'s AI provider',
    description: 'The workspace\'s own OpenAI-compatible provider, if it set one (the key is never returned), whether the server offers its own AI, and whether the plan allows bringing your own.',
    responses: { 200: { description: '`{ ai: { endpoint, model, ultraModel, hasApiKey } | null, platform: { available, metered }, allowed }`' } }
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
