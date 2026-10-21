defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List projects', responses: { 200: { description: '{ projects }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const rows = await new Parse.Query('Project').equalTo('workspace', ctx.workspace).ascending('name').limit(200).find(MASTER)
  const visible = rows.filter(row => !ctx.apiKeyProjectIds || ctx.apiKeyProjectIds.includes(row.id || ''))
  // The first read after upgrading copies the older legal.entity / marketing.postalAddress into the company profile.
  await Promise.all(visible.map(row => migrateCompany(row).catch(() => {})))
  return { projects: visible.map(serializeAdminProject) }
})
