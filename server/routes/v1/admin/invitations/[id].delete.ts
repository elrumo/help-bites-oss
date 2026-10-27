defineRouteMeta({ openAPI: { tags: ['Workspace'], summary: 'Revoke an invitation', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted: true }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'team.manage' })
  assertSession(ctx)
  const row = await new (useParse()).Query('WorkspaceInvite').get(getRouterParam(event, 'id') || '', MASTER).catch(() => null)
  assertWorkspaceRow(ctx, row, 'Invitation not found')
  await auditAccess(ctx, event, 'invitation.revoke', row.id)
  await row.destroy(MASTER)
  return { deleted: true }
})
