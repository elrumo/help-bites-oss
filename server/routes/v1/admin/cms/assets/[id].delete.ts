defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'deleteCmsAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a file',
    description: 'Removes it from the bucket and gives its storage back. Pages that use it show it broken from then on.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedCmsAsset(ctx, event)
  await deleteCmsAsset(row, ctx.workspaceId)
  return { ok: true }
})
