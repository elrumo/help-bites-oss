defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Save an error tracker URL and API token', operationId: 'saveErrorProviderSettings', description: 'With `scope: "project"`, only `project` uses them; otherwise every project of this workspace without its own. The response resolves for `project` when given. A blank `url` clears that scope. A blank `token` keeps the saved one while the URLs are unchanged.', security: [{ AgentSession: [] }, { AdminApiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { project: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'], default: 'global' }, url: { type: 'string', format: 'uri' }, apiUrl: { type: 'string', format: 'uri', description: 'Where HelpBites reaches the API, when not at `url`' }, token: { type: 'string', writeOnly: true }, org: { type: 'string', description: 'GlitchTip organisation slug' } } } } } }, responses: { 200: { description: '`{ providers }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const provider = getRouterParam(event, 'provider')
  if (!isErrorProvider(provider)) throw createError({ statusCode: 404, statusMessage: 'Unknown error tracker' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const project = body.project ? await requireProject(ctx, String(body.project)) : null
  if (body.scope === 'project' && !project) throw createError({ statusCode: 400, statusMessage: 'project is required for scope project' })
  // `global` is every project of this workspace (it used to be the whole install).
  await saveTrackerSettings(provider, ctx.workspace, body.scope === 'project' ? project : null, body)
  return { providers: await listErrorProviders(ctx.workspaceId, project) }
})
