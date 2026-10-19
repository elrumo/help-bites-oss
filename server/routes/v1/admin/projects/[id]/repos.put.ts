defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'Set the GitHub repos of a project', operationId: 'setProjectRepos', description: 'Replaces the list. Each repo must be visible to one of the workspace\'s GitHub connections.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['repos'], properties: { repos: { type: 'array', maxItems: 10, items: { type: 'object', required: ['installationId', 'id'], properties: { installationId: { type: 'string' }, id: { type: 'integer' } } } } } } } } }, security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ repos }`' }, 400: { description: 'Too many, or a repo the connection cannot see.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as { repos?: Array<{ installationId: string, id: number }> }
  if (!Array.isArray(body.repos)) throw createError({ statusCode: 400, statusMessage: 'Send repos as a list' })
  return { repos: await setProjectRepos(ctx.workspace, project, body.repos) }
})
