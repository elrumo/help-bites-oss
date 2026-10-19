defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'listSequences', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List sequences',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Operators and admin keys only.' }],
    responses: { 200: { description: '`{ sequences: [Sequence] }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const rows = await new (useParse()).Query('Sequence').equalTo('project', project).descending('createdAt').limit(200).find(MASTER)
  return { sequences: rows.map(serializeSequence) }
})
