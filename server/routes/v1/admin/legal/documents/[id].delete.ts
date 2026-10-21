defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'deleteLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a legal document and its versions',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  await deleteLegalDocument(row)
  await refreshLegalLinks(project)
  return { ok: true }
})
