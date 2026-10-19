defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Rename this workspace',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
    responses: { 200: { description: '{ workspace }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.settings' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if ('name' in body) ctx.workspace.set('name', workspaceName(body.name))
  await ctx.workspace.save(null, MASTER)
  await invalidate('workspace', ctx.workspaceId)
  return { workspace: serializeWorkspace(ctx.workspace, ctx.role) }
})
