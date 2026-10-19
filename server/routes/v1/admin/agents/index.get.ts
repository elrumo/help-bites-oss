defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List the team', description: 'Everyone in this workspace, with their role.', responses: { 200: { description: '{ agents }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true })
  return { agents: await listMembers(ctx.workspaceId) }
})
