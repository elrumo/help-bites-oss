defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'deleteLeadForm', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a lead form',
    description: 'Sites that ask for it get a 404 from then on. Its leads stay contacts, and its segment stays (it still finds them), so campaigns aimed at it keep working.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedLeadForm(ctx, event)
  await row.destroy(MASTER)
  return { ok: true }
})
