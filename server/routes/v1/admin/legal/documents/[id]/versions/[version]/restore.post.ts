defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'restoreLegalVersion', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Restore a version as the working draft',
    description: 'Copies a published version back into the document. It is not republished: review it, then publish.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: { 200: { description: 'The document with the restored text.' }, 404: { description: 'Document or version not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  await restoreLegalVersion(row, Number.parseInt(getRouterParam(event, 'version') || '', 10))
  return { document: serializeLegalDocument(project, row), coverage: legalCoverage(row) }
})
