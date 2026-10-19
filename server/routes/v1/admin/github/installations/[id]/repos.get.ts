defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'Repos a GitHub connection can read', operationId: 'listGithubRepos', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ repos: [{ id, fullName, private, defaultBranch }] }`' }, 410: { description: 'GitHub no longer has the installation.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  return { repos: await installationRepos(ctx.workspace, getRouterParam(event, 'id') || '') }
})
