defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'getLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get a legal document',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The document, with its rulepack coverage.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { document: serializeLegalDocument(project, row), coverage: legalCoverage(row) }
})
