defineRouteMeta({ openAPI: { tags: ['Workspace'], summary: 'Pending invitations', responses: { 200: { description: '{ invitations }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'team.manage' })
  return { invitations: (await pendingInvitations(ctx.workspaceId)).map(serializeInvitation) }
})
