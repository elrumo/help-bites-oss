defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'translateOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Translate an onboarding flow with AI',
    description: 'Translates the flow\'s working copy (name, titles, bodies, button labels and image descriptions) from its own language (`locale`) into each language in `locales`, and saves the result in `translations`. Strings that already have a translation are kept unless `overwrite` is true, so edits survive a re-run. Apps see it after the next publish. Uses the workspace\'s AI provider, or the server\'s gateway (metered in AI credits).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['locales'], properties: { locales: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Language tags such as `es`, `fr`, `pt-BR`.' }, overwrite: { type: 'boolean' } }, example: { locales: ['es', 'fr'] } } } } },
    responses: { 200: { description: 'The flow with its new translations.' }, 400: { description: 'No languages, or nothing to translate.' }, 404: { description: 'Not found.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI provider answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedOnboardingFlow(ctx, event)
  await translateOnboardingFlow(ctx, row, (await readBody(event).catch(() => ({}))) || {})
  return { flow: serializeOnboardingFlow(project, row) }
})
