defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'createCampaign', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a campaign',
    description: 'A draft: one of the project\'s templates (`template`: send key or id) to an audience. The audience is always subscribed contacts with an email; `audience.segment` narrows it and `audience.topic` leaves out anyone who opted out of that topic. Schedule or send it with `PATCH { status }`.\n\nEvery campaign must carry `{{unsubscribeUrl}}` and `{{project.address}}` (with the postal address set in the project\'s marketing settings), or it is refused. Recipients fill in `{{firstName}}`, `{{contact.name}}`, `{{contact.email}}` and `{{contact.<attribute>}}` (or the attribute\'s own name); `{{preferencesUrl}}` opens their email preferences.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string' }, subject: { type: 'string', description: 'Overrides the template\'s subject; placeholders fill in.' }, audience: { type: 'object', properties: { segment: { type: 'string' }, topic: { type: 'string' } } }, testMode: { type: 'boolean', description: 'Mailgun accepts and logs every message but delivers none.' }, project: { type: 'string' } } }, example: { name: 'October update', template: 'newsletter', audience: { segment: 'seg_123', topic: 'product' } } } } },
    responses: { 200: { description: '`{ campaign }`' }, 402: { description: 'The plan does not include campaigns.' }, 404: { description: 'No such template or segment.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  await assertFeature(await projectWorkspaceId(project), 'campaigns')
  const row = new (useParse().Object.extend('Campaign'))()
  row.set('project', project)
  row.set('status', 'draft')
  row.set('name', 'Untitled campaign')
  row.set('audience', { segment: '', topic: '' })
  await applyCampaignInput(project, row, body)
  await row.save(null, MASTER)
  return { campaign: serializeCampaign(row) }
})
