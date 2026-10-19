defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Try an AI provider',
    description: 'Sends one short prompt to the provider in the body (unsaved values from the form; a missing `apiKey` uses the saved one for that `id` when the endpoint is unchanged), or to the active saved provider when the body has no `endpoint`, and reports whether it answered. Nothing is saved.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, endpoint: { type: 'string' }, model: { type: 'string' }, apiKey: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ ok, model, reply?, error? }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.settings' })
  await assertFeature(ctx.workspace, 'byoLlm')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  // The form's values on a copy, so a test never changes what is saved; no endpoint in the body tests what is saved.
  const draft = ctx.workspace.clone()
  draft.set('ai', ctx.workspace.get('ai'))
  if ('endpoint' in body) applyWorkspaceAiInput(draft, { providers: [body], active: body.id })
  const settings = readWorkspaceAi(draft)
  if (!settings) throw createError({ statusCode: 400, statusMessage: 'Enter the provider\'s endpoint' })
  const route: AiRoute = { source: 'workspace', endpoint: settings.endpoint, apiKey: settings.apiKey, model: settings.model || 'gpt-4o-mini', metered: false, workspaceId: ctx.workspaceId }
  try {
    const { text, model } = await chatCompletion(route, { messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 5, temperature: 0 }, { timeoutMs: 20_000 })
    return { ok: true, model, reply: text.slice(0, 100) }
  } catch (error) {
    return { ok: false, model: route.model, error: String((error as { statusMessage?: string }).statusMessage || (error as Error).message).slice(0, 300) }
  }
})
