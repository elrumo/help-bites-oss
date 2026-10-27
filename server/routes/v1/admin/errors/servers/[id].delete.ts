defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Remove an error tracking server', operationId: 'removeErrorServer', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ servers }`' }, 409: { description: 'Projects still report to it.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  await deleteErrorServer(ctx.workspace, getRouterParam(event, 'id') || '')
  return { servers: await listErrorServers(ctx.workspaceId) }
})
