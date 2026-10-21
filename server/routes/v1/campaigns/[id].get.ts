defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'getCampaign', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One campaign, with live numbers',
    description: '`audienceCount` is who it would go to right now (before it starts). The recipients themselves are in the email log: `GET /v1/email-logs?batch=cm_<id>`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ campaign, audienceCount, problems }` — `problems` lists what stops it from being sent.' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const row = await getProjectCampaign(project, getRouterParam(event, 'id') || '')
  const campaign = serializeCampaign(row)
  campaign.stats = await refreshCampaignStats(row)
  let audienceCount: number | null = null
  let problems: string[] = []
  if (campaign.status === 'draft' || campaign.status === 'scheduled') {
    audienceCount = await (await campaignAudience(project, campaign.audience)).count(MASTER).catch(() => null)
    try {
      problems = campaign.template || campaign.blogPostId ? complianceProblems(project, (await campaignContent(project, row)).document) : ['Pick a template']
    } catch (error) {
      problems = [String((error as { statusMessage?: string }).statusMessage || (error as Error).message)]
    }
    if (!process.env.APP_URL) problems.push('Set APP_URL on the server: unsubscribe links need a public address')
    if (!hasRootSecret()) problems.push('Set HELPBITES_SECRET on the server: it signs unsubscribe links')
  }
  return { campaign, audienceCount, problems }
})
