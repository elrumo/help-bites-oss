defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Revoke a general admin API key', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted: true }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  assertSession(ctx)
  const Parse = useParse()
  const row = await new Parse.Query('AdminApiKey').get(getRouterParam(event, 'id') || '', MASTER).catch(() => null)
  assertWorkspaceRow(ctx, row, 'API key not found')
  await row.destroy(MASTER)
  return { deleted: true }
})
