defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'translateEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Translate an email template with AI',
    description: 'Translates the template\'s words (subject, preheader, headings, text, buttons, image descriptions and component text) from its own language (`locale`) into each language in `locales`, and saves them in `translations` next to the design. `{{placeholders}}`, links and HTML tags are kept; a string whose translation lost one is left in the original language. Strings already translated are kept unless `overwrite` is true. Send it in a language with `locale` on `POST /v1/emails/send`. A linked template uses its master\'s translations, so translate the master. Uses the workspace\'s AI provider, or the server\'s gateway (metered in AI credits).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['locales'], properties: { locales: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Language tags such as `es`, `fr`, `pt-BR`.' }, overwrite: { type: 'boolean' } }, example: { locales: ['es', 'fr'] } } } } },
    responses: { 200: { description: '`{ template }` with its new translations.' }, 400: { description: 'No languages, nothing to translate, or a linked template.' }, 404: { description: 'Not found.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI provider answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  await translateEmailTemplate(ctx, row, (await readBody(event).catch(() => ({}))) || {})
  return { template: await saveAndBroadcast(row) }
})
