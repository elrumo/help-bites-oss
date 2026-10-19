defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'List knowledge models', parameters: [{ name: 'projectId', in: 'query', schema: { type: 'string' }, description: 'Scope to one project' }], responses: { 200: { description: '{ models }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const projectId = String(getQuery(event).projectId || '')
  const query = limitToKeyProjects(ctx, new Parse.Query('KnowledgeModel')).equalTo('workspace', ctx.workspace).ascending('name').limit(500)
  if (projectId) query.equalTo('project', await requireProject(ctx, projectId))
  const rows = await query.find(MASTER)
  return { models: rows.map(serializeKnowledgeModel) }
})
