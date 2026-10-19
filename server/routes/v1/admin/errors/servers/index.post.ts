defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Add an error tracking server', operationId: 'addErrorServer', security: [{ AgentSession: [] }, { AdminApiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['provider', 'url'], properties: { provider: { type: 'string', enum: ['glitchtip', 'bugsink'] }, name: { type: 'string' }, url: { type: 'string', format: 'uri' }, apiUrl: { type: 'string', format: 'uri', description: 'Where HelpBites reaches the API, when not at `url`' }, token: { type: 'string', writeOnly: true }, org: { type: 'string', description: 'GlitchTip organisation slug' } } } } } }, responses: { 200: { description: '`{ id, servers }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const id = await saveErrorServer(ctx.workspace, (await readBody(event).catch(() => ({}))) as Record<string, unknown>)
  return { id, servers: await listErrorServers(ctx.workspaceId) }
})
