defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'listSegments', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List segments',
    description: 'Saved filters over the project\'s contacts. Use one with `GET /v1/contacts?segment=` or as a campaign\'s audience.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Operators and admin keys only.' }],
    responses: { 200: { description: '`{ segments: [Segment] }`', content: { 'application/json': { schema: { type: 'object', properties: { segments: { type: 'array', items: { '$ref': '#/components/schemas/Segment' } } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const rows = await new (useParse()).Query('ContactSegment').equalTo('project', project).ascending('name').limit(500).find(MASTER)
  return { segments: rows.map(serializeSegment) }
})
