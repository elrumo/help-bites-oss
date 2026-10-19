defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Rename a tracker project', operationId: 'updateErrorLink', description: 'Changes the pill label. The id is one from `project.errorLinks`.', security: [{ AgentSession: [] }, { AdminApiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'label'], properties: { project: { type: 'string' }, label: { type: 'string' } } } } } }, responses: { 200: { description: '`{ project, link }`' }, 404: { description: 'No such tracker project.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = (await readBody(event).catch(() => ({}))) as { project?: string, label?: string }
  const project = await requireProject(ctx, String(body.project || ''))
  const link = await updateErrorLink(project, getRouterParam(event, 'id') || '', body)
  return { project: serializeAdminProject(project), link: errorLinkView(project, link) }
})
