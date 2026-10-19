defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Set this workspace\'s AI provider',
    description: 'Any OpenAI-compatible endpoint (OpenAI, Azure, OpenRouter, a LiteLLM of your own…). Assistants without an endpoint of their own, the email designer and error notes then use it instead of the server\'s AI, and it costs no AI credits. `endpoint: ""` turns it off. `apiKey` is write-only: a string sets it, `""` clears it, leaving it out keeps the saved one.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { endpoint: { type: 'string', example: 'https://api.openai.com/v1' }, model: { type: 'string', example: 'gpt-4o-mini' }, ultraModel: { type: 'string', description: 'The stronger model for the Ultra email designer; the model when blank.' }, apiKey: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ ai }`' }, 402: { description: 'The plan does not include your own AI provider.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.settings' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (String(body.endpoint || '').trim()) await assertFeature(ctx.workspace, 'byoLlm')
  applyWorkspaceAiInput(ctx.workspace, body)
  await ctx.workspace.save(null, MASTER)
  await invalidate('workspace', ctx.workspaceId)
  return { ai: serializeWorkspaceAi(ctx.workspace) }
})
