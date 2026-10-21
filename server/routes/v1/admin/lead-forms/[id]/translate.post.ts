defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'translateLeadForm', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Translate a lead form with AI',
    description: 'Translates the form\'s words (title, description, button, thank-you messages, footnote, and each field\'s label, placeholder and options) from its own language (`locale`) into each language in `locales`, and saves the result in `translations`. Words that already have a translation are kept unless `overwrite` is true, so edits survive a re-run. Visitors see it at once. Uses the workspace\'s AI provider, or the server\'s gateway (metered in AI credits).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['locales'], properties: { locales: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Language tags such as `es`, `fr`, `pt-BR`.' }, overwrite: { type: 'boolean' } }, example: { locales: ['es', 'fr'] } } } } },
    responses: { 200: { description: '`{ form }` with its new translations.' }, 400: { description: 'No languages, or nothing to translate.' }, 404: { description: 'Not found.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI provider answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLeadForm(ctx, event)
  await translateLeadForm(ctx, row, (await readBody(event).catch(() => ({}))) || {})
  return { form: serializeLeadForm(project, row, await leadFormStats(project, row.id || '')) }
})
