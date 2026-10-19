defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'GitHub repos of a project', operationId: 'getProjectRepos', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ repos: [{ installationId, id, fullName, defaultBranch }] }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return { repos: projectRepos(await requireProject(ctx, getRouterParam(event, 'id') || '')) }
})
