defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List projects', responses: { 200: { description: '{ projects }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const rows = await new Parse.Query('Project').equalTo('workspace', ctx.workspace).ascending('name').limit(200).find(MASTER)
  return { projects: rows.filter(row => !ctx.apiKeyProjectIds || ctx.apiKeyProjectIds.includes(row.id || '')).map(serializeAdminProject) }
})
