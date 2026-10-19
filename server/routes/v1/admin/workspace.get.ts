defineRouteMeta({ openAPI: { tags: ['Workspace'], summary: 'This workspace', description: 'The workspace the request acts in (`X-Workspace`, else your default) and your role there.', responses: { 200: { description: '{ workspace }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { allowInactive: true, workspaceWide: true })
  return { workspace: serializeWorkspace(ctx.workspace, ctx.role) }
})
