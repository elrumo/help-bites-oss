defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List this workspace\'s admin API keys', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '{ keys } — key values are never returned.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  const Parse = useParse()
  const rows = await new Parse.Query('AdminApiKey').equalTo('workspace', ctx.workspace).descending('createdAt').limit(200).find(MASTER)
  return { keys: rows.map(serializeAdminApiKey) }
})
