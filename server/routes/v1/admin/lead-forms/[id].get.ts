defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'getLeadForm', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get a lead form',
    description: 'One form, with live `stats`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ form }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { project, row } = await scopedLeadForm(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { form: serializeLeadForm(project, row, await leadFormStats(project, row.id || '')) }
})
