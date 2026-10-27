defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'updateCampaign', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit, schedule, send, pause or cancel a campaign',
    description: 'Content fields as on create (drafts and scheduled campaigns only). `status`: `scheduled` (with `scheduledAt`), `sending` (send now, or resume a paused one), `paused`, `canceled`, or `draft` (unschedule). Scheduling checks the template for an unsubscribe link and the postal address first.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string' }, subject: { type: 'string' }, audience: { type: 'object' }, testMode: { type: 'boolean' }, status: { type: 'string', enum: ['draft', 'scheduled', 'sending', 'paused', 'canceled'] }, scheduledAt: { type: 'string', format: 'date-time' }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ campaign }`' }, 400: { description: 'Not compliant, or a bad date.' }, 402: { description: 'Scheduling or sending, and the plan does not include campaigns.' }, 409: { description: 'That change is not possible from its current status.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project, { can: 'marketing' })
  const row = await getProjectCampaign(project, getRouterParam(event, 'id') || '')
  // Pausing, canceling and editing stay open after a downgrade; only sending needs the plan.
  if (body.status === 'scheduled' || body.status === 'sending') await assertFeature(await projectWorkspaceId(project), 'campaigns')
  await applyCampaignInput(project, row, body)
  if (typeof body.status === 'string') await moveCampaign(project, row, body.status, body.scheduledAt)
  await row.save(null, MASTER)
  // "Send now": start it in this request rather than on the next worker tick.
  if (row.get('status') === 'scheduled' && (row.get('scheduledAt') as Date).getTime() <= Date.now()) void runCampaign(row.id || '').catch(error => console.error('[campaigns] start failed:', (error as Error).message))
  return { campaign: serializeCampaign(row) }
})
