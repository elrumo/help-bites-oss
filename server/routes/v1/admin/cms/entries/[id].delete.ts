defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'deleteCmsEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete an entry',
    description: 'Its page answers 404 from then on, and the delivery API no longer lists it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedCmsEntry(ctx, event)
  await row.destroy(MASTER)
  return { ok: true }
})
