defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'listLegalVersions', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List published versions',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Versions, newest first.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedLegalDocument(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { versions: await listLegalVersions(row) }
})
