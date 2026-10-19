import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'List error trackers and whether each is set up', operationId: 'listErrorProviders', description: 'Settings resolve per tracker from the project (`?project=`), then every project, then the server env. Tokens are never returned, only `hasToken`.', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const projectId = clampText(getQuery(event).project, 40)
  return { providers: await listErrorProviders(ctx.workspaceId, projectId ? await requireProject(ctx, projectId) : null) }
})
