defineRouteMeta({
  openAPI: {
    tags: ['Saved replies'], operationId: 'deleteSavedReply', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a saved reply',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.savedReply(ctx, getRouterParam(event, 'id') || '')
  await row.destroy(MASTER)
  return { ok: true }
})
