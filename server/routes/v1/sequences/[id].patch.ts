defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'updateSequence', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit, activate or pause a sequence',
    description: '`status`: `active` (checks every step for an unsubscribe link and the postal address), `paused` (people stay where they are), `draft`. Changing the steps of an active sequence applies to each person from their next step.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, trigger: { type: 'object' }, steps: { type: 'array' }, status: { type: 'string', enum: ['draft', 'active', 'paused'] }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ sequence }`' }, 400: { description: 'Invalid, or not compliant.' }, 402: { description: 'Activating, and the plan does not include sequences.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project, { can: 'marketing' })
  const row = await getProjectSequence(project, getRouterParam(event, 'id') || '')
  if (body.status === 'active' && row.get('status') !== 'active') await assertFeature(await projectWorkspaceId(project), 'sequences')
  await applySequenceInput(project, row, body)
  if (body.status !== undefined) await setSequenceStatus(project, row, body.status)
  await row.save(null, MASTER)
  return { sequence: serializeSequence(row) }
})
