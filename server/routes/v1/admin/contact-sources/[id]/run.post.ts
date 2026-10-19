defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'runContactSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Sync now',
    description: 'Starts a run in the background (poll the source for `status` and `stats`). `reset: true` forgets the cursor and reads everything again — after changing the mapping, for example.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, reset: { type: 'boolean' } } } } } },
    responses: { 200: { description: '`{ source }` (status running)' }, 402: { description: 'The plan does not include database sync.' }, 409: { description: 'A run is already going.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  await assertFeature(ctx.workspace, 'contactSources')
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const row = await getProjectSource(project, getRouterParam(event, 'id') || '')
  if (row.get('status') === 'running' && row.updatedAt && Date.now() - row.updatedAt.getTime() < 120_000) throw createError({ statusCode: 409, statusMessage: 'A sync is already running' })
  row.set('status', 'running')
  await row.save(null, MASTER)
  // The first stretch runs now; the worker continues it if there is more.
  void runSourceSync(row.id || '', { reset: body.reset === true }).catch(error => console.error('[sources] run failed:', (error as Error).message))
  return { source: serializeContactSource(row) }
})
