defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'List the error tracking servers of this workspace', operationId: 'listErrorServers', description: 'Every project of the workspace can report to any of these. `builtIn` servers come from the HelpBites server\'s own env and can\'t be edited. Tokens are never returned, only `hasToken`.', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return { servers: await listErrorServers(ctx.workspaceId), providers: errorProviderInfo() }
})
