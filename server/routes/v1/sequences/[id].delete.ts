defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'deleteSequence', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a sequence',
    description: 'Everyone on it stops getting its emails. The log keeps what was sent.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ deleted: true }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const row = await getProjectSequence(project, getRouterParam(event, 'id') || '')
  const Parse = useParse()
  for (;;) {
    const page = await new Parse.Query('SequenceEnrollment').equalTo('sequence', row).limit(500).find(MASTER)
    if (!page.length) break
    await Parse.Object.destroyAll(page, MASTER)
  }
  await row.destroy(MASTER)
  return { deleted: true }
})
