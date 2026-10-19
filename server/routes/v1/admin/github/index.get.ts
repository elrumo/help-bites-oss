defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'GitHub connections of this workspace', operationId: 'listGithubConnections', description: '`configured` is false until the server owner has registered a GitHub App (docs/GITHUB.md).', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ configured, installations }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return { configured: githubConfigured(), installations: listInstallations(ctx.workspace) }
})
