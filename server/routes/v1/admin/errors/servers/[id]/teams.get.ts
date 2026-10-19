defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'List the teams a new project can be created under on a server', operationId: 'listErrorTeams', description: 'Bugsink only; empty for trackers without teams to choose from. `default` is used when `team` is omitted from connect.', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ default, teams }`' }, 404: { description: 'No such server.' }, 502: { description: 'The tracker rejected the request.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return listErrorTeams(ctx.workspaceId, getRouterParam(event, 'id') || '')
})
