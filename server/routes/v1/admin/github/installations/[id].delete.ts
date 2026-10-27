defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'Disconnect a GitHub account', operationId: 'removeGithubConnection', description: 'Forgets the connection here; uninstall the app on GitHub to revoke it there too.', security: [{ AgentSession: [] }], responses: { 200: { description: '`{ installations }`' }, 409: { description: 'Projects still use its repos.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  assertWorkspaceWide(ctx)
  await removeInstallation(ctx.workspace, getRouterParam(event, 'id') || '')
  return { installations: listInstallations(ctx.workspace) }
})
