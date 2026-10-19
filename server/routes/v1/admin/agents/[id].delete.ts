defineRouteMeta({
  openAPI: { tags: ['Agent'], summary: 'Remove a teammate', description: 'Takes them out of this workspace, with the API keys they made for it. You cannot remove yourself, and a workspace keeps at least one owner.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted: true }' } } }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'team.manage' })
  const id = getRouterParam(event, 'id') || ''
  if (id === ctx.agentId) throw createError({ statusCode: 400, statusMessage: 'You cannot remove your own account' })
  const remaining = await removeMember(ctx, id)
  if (remaining === 0 && edition().policy.removeAccountWithLastMembership) {
    // Their last team: the account goes too, as it always did on a one-team install.
    const Parse = useParse()
    const user = Parse.User.createWithoutData(id)
    await revokeAgentSessions(id)
    await Parse.Object.destroyAll(await new Parse.Query('AdminApiKey').equalTo('agent', user).find(MASTER), MASTER)
    await user.destroy(MASTER).catch(() => {})
  } else {
    // Still signed in elsewhere: just stop any cached session acting here.
    await invalidate('agent', id)
  }
  return { deleted: true }
})
