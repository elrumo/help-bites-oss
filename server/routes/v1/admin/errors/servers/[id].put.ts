defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Change an error tracking server', operationId: 'updateErrorServer', description: 'A blank `token` keeps the saved one while the URLs are unchanged. The tracker can\'t be changed.', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ id, servers }`' }, 404: { description: 'No such server.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const id = await saveErrorServer(ctx.workspace, (await readBody(event).catch(() => ({}))) as Record<string, unknown>, getRouterParam(event, 'id') || '')
  return { id, servers: await listErrorServers(ctx.workspaceId) }
})
