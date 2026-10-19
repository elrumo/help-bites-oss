defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'listCampaigns', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List campaigns',
    description: 'Newest first. Each carries its numbers (`stats`), counted from the email log.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Operators and admin keys only.' }],
    responses: { 200: { description: '`{ campaigns: [Campaign] }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const rows = await new (useParse()).Query('Campaign').equalTo('project', project).descending('createdAt').limit(200).find(MASTER)
  return { campaigns: rows.map(serializeCampaign) }
})
