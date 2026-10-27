defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Rename a general admin API key', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } }, responses: { 200: { description: '{ apiKey }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  assertSession(ctx)
  const name = String(((await readBody(event).catch(() => ({}))) as Record<string, unknown>).name || '').trim().slice(0, 80)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  const Parse = useParse()
  const row = await new Parse.Query('AdminApiKey').get(getRouterParam(event, 'id') || '', MASTER).catch(() => null)
  assertWorkspaceRow(ctx, row, 'API key not found')
  row.set('name', name)
  await row.save(null, MASTER)
  return { apiKey: serializeAdminApiKey(row) }
})
