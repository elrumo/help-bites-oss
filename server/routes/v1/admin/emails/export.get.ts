defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'exportEmailTemplates', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Export email templates',
    description: 'Every template of a project (`?project=`) or every master, in the format `POST /v1/admin/emails/import` takes: designs with their variables, folder paths, and linked masters by id and name with the project\'s values. `?download=1` serves it as a file.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'download', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ version: 1, exportedAt, project, templates }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const project = query.project ? await requireProject(ctx, String(query.project)) : null
  // The shared master templates belong to the workspace, not to a project.
  if (!project) assertWorkspaceWide(ctx)
  const templates = await exportEmailTemplates(project, ctx.workspace)
  if (query.download) {
    const name = project ? slugKey(project.get('name')) || 'project' : 'masters'
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="helpbites-emails-${name}.json"`)
  }
  return { version: 1, exportedAt: new Date().toISOString(), project: project ? { id: project.id, name: String(project.get('name') || '') } : null, templates }
})
