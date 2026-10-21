defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'deleteBrandAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a brand kit file',
    description: 'Removes the file from the bucket and frees its storage. A project logo or onboarding image that pointed at its URL stops loading.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedBrandAsset(ctx, event)
  await deleteBrandAsset(row, ctx.workspaceId)
  await refreshBrandLook(project)
  return { ok: true }
})
