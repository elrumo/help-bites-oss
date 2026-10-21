defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'deleteCmsComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a component',
    description: 'Entries keep the blocks that used it, with their values; they render as nothing until a component with the same key exists again.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedCmsComponent(ctx, event)
  await row.destroy(MASTER)
  return { ok: true }
})
