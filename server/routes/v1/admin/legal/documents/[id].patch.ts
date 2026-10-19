defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'updateLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a legal document',
    description: 'Only the keys sent change. `sections` is the full list: a section whose id is unknown is added, one left out is removed, and a template section whose text you change becomes `human` (and is then kept through a recompose). `tldr` is a string you write (source `human`) or `null` to clear it. Editing a published document changes the live page at once; republish to record a version.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { tldr: 'We collect your email and never sell it.', sections: [{ id: 'privacy.who', body: 'New text', locked: true }] } } } } },
    responses: { 200: { description: 'The updated document.' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  await applyLegalInput(project, row, (await readBody(event).catch(() => ({}))) || {})
  await row.save(null, MASTER)
  return { document: serializeLegalDocument(project, row), coverage: legalCoverage(row) }
})
