defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'recomposeLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Recompose a document from its answers',
    description: 'Re-runs the clause composer (no AI) on the saved answers, or on new `answers` sent here. Sections written by a person or by AI, and locked sections, keep their text; template sections are refreshed, and clauses that stop or start applying are removed or added.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { answers: { regions: ['eu', 'uk'] } } } } } },
    responses: { 200: { description: 'The recomposed draft.' }, 400: { description: 'Invalid answers.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  await recomposeLegalDocument(project, row, body.answers)
  return { document: serializeLegalDocument(project, row), coverage: legalCoverage(row) }
})
