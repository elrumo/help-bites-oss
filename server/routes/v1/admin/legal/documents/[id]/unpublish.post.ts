defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'unpublishLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Take a legal document offline',
    description: 'Back to draft: its public path answers 404. Versions are kept.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The draft.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  await unpublishLegalDocument(row)
  return { document: serializeLegalDocument(project, row) }
})
