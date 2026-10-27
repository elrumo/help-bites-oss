defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Rename a general admin API key, or make it read-only', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, readOnly: { type: 'boolean', description: 'true: the key reads and changes nothing from now on. false: it may write again.' } } } } } }, responses: { 200: { description: '{ apiKey }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  assertSession(ctx)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const name = body.name === undefined ? undefined : String(body.name || '').trim().slice(0, 80)
  if (name === '' || (name === undefined && body.readOnly === undefined)) throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  if (body.readOnly !== undefined && typeof body.readOnly !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'readOnly must be true or false' })
  const Parse = useParse()
  const row = await new Parse.Query('AdminApiKey').get(getRouterParam(event, 'id') || '', MASTER).catch(() => null)
  assertWorkspaceRow(ctx, row, 'API key not found')
  if (name !== undefined) row.set('name', name)
  if (typeof body.readOnly === 'boolean') {
    if (body.readOnly) row.set('readOnly', true)
    else row.unset('readOnly')
  }
  await row.save(null, MASTER)
  await auditAccess(ctx, event, 'apikey.update', row.id, { name, readOnly: typeof body.readOnly === 'boolean' ? body.readOnly : undefined })
  return { apiKey: serializeAdminApiKey(row) }
})
