defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'translateLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Translate a legal document with AI',
    description: 'Creates a new draft that is this document in another language: every section, the title and the summary are translated; section ids, clauses, locked flags and the requirements they satisfy carry over, and the text is marked `ai` so it shows up for review. The copy is linked to the original (`translationOf`), so the public page links the languages to each other. A language the document already has answers 409. Nothing is published. Not legal advice: have the translation reviewed. Needs an AI provider (501 otherwise).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['locale'], properties: { locale: { type: 'string', description: 'A language tag such as `es`, `fr` or `pt-BR`.' } }, example: { locale: 'es' } } } } },
    responses: { 200: { description: 'The new draft document.' }, 400: { description: 'Missing or invalid language.' }, 404: { description: 'Not found.' }, 409: { description: 'The document already has a copy in that language.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider configured.' }, 502: { description: 'The AI provider answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  // A translation is a new document, so it counts as creating one.
  await assertFeature(ctx.workspace, 'legalDocs')
  const { project, row } = await scopedLegalDocument(ctx, event)
  const copy = await translateLegalDocument(ctx, project, row, (await readBody(event).catch(() => ({}))) || {})
  return { document: serializeLegalDocument(project, copy) }
})
