defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'publishLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Publish a legal document',
    description: 'Makes the document public at its path and records a version (a snapshot you can restore). Publish again after edits to record the next version.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { note: 'Added Stripe' } } } } },
    responses: { 200: { description: 'The published document.' }, 400: { description: 'The document has no text.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  await publishLegalDocument(row, String(ctx.agent.get('name') || ctx.agent.get('username') || ''), typeof body.note === 'string' ? body.note : '')
  await refreshLegalLinks(project)
  return { document: serializeLegalDocument(project, row) }
})
