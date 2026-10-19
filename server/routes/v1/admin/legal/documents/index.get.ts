defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'listLegalDocuments', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List legal documents',
    description: 'Every legal document of the project, drafts included, each with its sections, summary (TL;DR), status and public path.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: 'Documents.' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await legalProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { documents: (await listLegalDocuments(project)).map(row => serializeLegalDocument(project, row)) }
})
