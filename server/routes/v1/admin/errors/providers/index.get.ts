defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'List error trackers and whether a server is connected for each', operationId: 'listErrorProviders', description: 'Use `GET /v1/admin/errors/servers` to see the servers themselves.', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return { providers: await listErrorProviders(ctx.workspaceId) }
})
