defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Set this workspace\'s AI providers',
    description: 'The workspace\'s own AI providers: any OpenAI-compatible endpoint (OpenAI, Anthropic, Gemini, OpenRouter, a LiteLLM of your own…), saved as a list with one `active`. Assistants without an endpoint of their own, the email designer and error notes use the active one instead of the server\'s AI, and it costs no AI credits. This replaces the whole list; an empty `providers` turns it off. A provider\'s `apiKey` is write-only: a string sets it, `""` clears it, leaving it out keeps the saved one (while its endpoint is unchanged).',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
      providers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', example: 'openai' }, name: { type: 'string' }, endpoint: { type: 'string', example: 'https://api.openai.com/v1' }, model: { type: 'string', example: 'gpt-4o-mini' }, ultraModel: { type: 'string', description: 'The stronger model for the Ultra email designer; the model when blank.' }, apiKey: { type: 'string' } } } },
      active: { type: 'string', description: 'The id of the provider in use.' }
    } } } } },
    responses: { 200: { description: '`{ ai }`' }, 402: { description: 'The plan does not include your own AI provider.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.settings' })
  assertSession(ctx)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (Array.isArray(body.providers) && body.providers.length) await assertFeature(ctx.workspace, 'byoLlm')
  applyWorkspaceAiInput(ctx.workspace, body)
  await ctx.workspace.save(null, MASTER)
  await invalidate('workspace', ctx.workspaceId)
  return { ai: serializeWorkspaceAi(ctx.workspace) }
})
