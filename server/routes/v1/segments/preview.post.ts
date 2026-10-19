import { EMPTY_SEGMENT } from '#shared/segments'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'previewSegment', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Count who a filter matches',
    description: 'Pass a `filter` to try one before saving it, or a `segment` id.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { filter: { type: 'object' }, segment: { type: 'string' }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ count, sample: [Contact] }` (up to 10, most recently updated).' }, 400: { description: 'Invalid filter.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const filter = typeof body.segment === 'string' && body.segment
    ? serializeSegment(await getProjectSegment(project, body.segment)).filter
    : readSegmentFilter(body.filter ?? EMPTY_SEGMENT)
  return previewSegment(project, filter)
})
