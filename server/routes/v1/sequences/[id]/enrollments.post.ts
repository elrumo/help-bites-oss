defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'enrollInSequence', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Put contacts on a sequence by hand',
    description: 'Pass `contacts` (up to 100 contact ids) or `segment` (a segment id: everyone in it, up to 5,000 per call; `truncated` says to call again for the rest). Only subscribed contacts get its emails; anyone already on it (now or before) is left alone. For a sequence with a topic, segment members who opted out of the topic are skipped too. `skipped` counts the people who were not enrolled, by reason.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { contacts: { type: 'array', items: { type: 'string' }, maxItems: 100 }, segment: { type: 'string' }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ enrolled, skipped: { notSubscribed, optedOut, alreadyEnrolled, notFound }, truncated }`' }, 400: { description: 'Neither `contacts` nor `segment`, or both.' }, 404: { description: 'No such sequence or segment in this project.' }, 409: { description: 'The sequence is not active.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const sequence = await getProjectSequence(project, getRouterParam(event, 'id') || '')
  if (sequence.get('status') !== 'active') throw createError({ statusCode: 409, statusMessage: 'Activate the sequence first' })
  const segment = typeof body.segment === 'string' ? body.segment.trim() : ''
  if (segment && body.contacts !== undefined) throw createError({ statusCode: 400, statusMessage: 'Pass contacts or segment, not both' })
  if (segment) return await enrollSegment(project, sequence, segment)
  if (!Array.isArray(body.contacts)) throw createError({ statusCode: 400, statusMessage: 'Pass contacts (a list of contact ids) or segment (a segment id)' })
  return await enrollContactIds(project, sequence, body.contacts.map(String).slice(0, 100))
})
