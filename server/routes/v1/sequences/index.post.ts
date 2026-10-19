defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'createSequence', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a sequence',
    description: 'A draft series of emails. `trigger`: `{ type: "subscribed", topic? }` (starts when someone subscribes), `{ type: "event", event }` (starts on `POST /v1/track` with that event), or `{ type: "manual" }`. `steps`: `[{ delayMinutes, template, subject? }]`, each delay counted from the step before (the first from enrollment). Activate with `PATCH { status: "active" }`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, trigger: { type: 'object' }, steps: { type: 'array', items: { type: 'object' } }, project: { type: 'string' } } }, example: { name: 'Welcome', trigger: { type: 'subscribed' }, steps: [{ delayMinutes: 0, template: 'welcome' }, { delayMinutes: 4320, template: 'tips' }] } } } },
    responses: { 200: { description: '`{ sequence }`' }, 400: { description: 'Bad trigger or steps.' }, 402: { description: 'The plan does not include sequences.' }, 404: { description: 'A step names no template of this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  await assertFeature(await projectWorkspaceId(project), 'sequences')
  const row = new (useParse().Object.extend('Sequence'))()
  row.set('project', project)
  row.set('status', 'draft')
  row.set('name', 'Untitled sequence')
  await applySequenceInput(project, row, body)
  await row.save(null, MASTER)
  return { sequence: serializeSequence(row) }
})
