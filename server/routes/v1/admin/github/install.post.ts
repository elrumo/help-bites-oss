defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'Start connecting a GitHub account', operationId: 'startGithubInstall', description: 'Returns the GitHub URL where the person installs the app on their account or organisation.', security: [{ AgentSession: [] }], responses: { 200: { description: '`{ url }`' }, 501: { description: 'No GitHub App is registered on this server.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertWorkspaceWide(ctx)
  return { url: installUrl(ctx.workspaceId, ctx.agentId) }
})
