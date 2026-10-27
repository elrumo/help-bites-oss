defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'deleteCampaign', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a campaign',
    description: 'Not while it is sending (pause or cancel it first). The log keeps what was sent.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ deleted: true }`' }, 409: { description: 'It is sending.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller, undefined, { can: 'marketing' })
  const row = await getProjectCampaign(project, getRouterParam(event, 'id') || '')
  if (row.get('status') === 'sending') throw createError({ statusCode: 409, statusMessage: 'Pause or cancel the campaign before deleting it' })
  await row.destroy(MASTER)
  return { deleted: true }
})
