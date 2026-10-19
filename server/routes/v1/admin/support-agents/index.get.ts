defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List AI support agents', parameters: [{ name: 'projectId', in: 'query', schema: { type: 'string' }, description: 'Scope to one project' }], responses: { 200: { description: '{ agents }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const projectId = String(getQuery(event).projectId || '')
  const query = limitToKeyProjects(ctx, new Parse.Query('SupportAgent')).equalTo('workspace', ctx.workspace).ascending('name').limit(500)
  if (projectId) query.equalTo('project', await requireProject(ctx, projectId))
  const rows = await query.find(MASTER)
  return { agents: rows.map(serializeSupportAgent) }
})
