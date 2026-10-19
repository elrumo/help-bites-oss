defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'testCampaign', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Send a test of a campaign',
    description: 'Up to five addresses, "[Test]" in front of the subject. An address that is a contact gets their own values filled in; its unsubscribe link works for real.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { type: 'array', items: { type: 'string' }, maxItems: 5 }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ id, sent, failed, suppressed, results }`' }, 402: { description: 'The plan does not include campaigns, or the workspace\'s emails for this month or today would run out.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  await assertFeature(await projectWorkspaceId(project), 'campaigns')
  await rateLimit(`sb:rl:campaigntest:${caller.actor.id || project.id}`, LIMITS.campaignTestsPerAgent.limit, LIMITS.campaignTestsPerAgent.window)
  const row = await getProjectCampaign(project, getRouterParam(event, 'id') || '')
  const recipients = parseEmailRecipients(body.to, 5)
  const snapshot = (row.get('snapshot') as Awaited<ReturnType<typeof snapshotCampaign>> | undefined) || await snapshotCampaign(project, String(row.get('template') || ''))
  // A stand-in contact for addresses that are not one, so placeholders still fill.
  const Parse = useParse()
  const contacts = await Promise.all(recipients.map(async (r) => {
    const found = await findContactBy(project, { email: r.email })
    if (found) return found
    const standIn = new (Parse.Object.extend('EndUser'))() as ParseObject
    standIn.id = 'test'
    standIn.set('email', r.email)
    standIn.set('name', r.name)
    return standIn
  }))
  const batchId = newEmailBatchId()
  const audience = serializeCampaign(row).audience
  const results = await deliverEmails(campaignEmails(project, snapshot, contacts, { batchId, subject: String(row.get('subject') || ''), topic: audience.topic, testMode: row.get('testMode') === true, source: 'test', actor: caller.actor, base: publicBaseUrl() }).map(m => ({ ...m, ignoreSuppressions: true })))
  return summarizeDeliveries(batchId, results)
})
