defineRouteMeta({ openAPI: { tags: ['Workspace'], summary: 'Your workspaces', description: 'Every workspace the signed-in agent belongs to, with their role in each.', responses: { 200: { description: '{ workspaces }' } } } })

export default defineEventHandler(async (event) => {
  const { agentId } = await requireAgentIdentity(event)
  const memberships = await membershipsOf(agentId)
  const rows = await Promise.all(memberships.map(async m => ({ m, row: await getWorkspace(m.workspaceId) })))
  return { workspaces: rows.flatMap(({ m, row }) => row ? [serializeWorkspace(row, m.role)] : []) }
})
