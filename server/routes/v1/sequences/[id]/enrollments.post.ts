defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'enrollInSequence', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Put contacts on a sequence by hand',
    description: 'Up to 100 contact ids. Only subscribed contacts get its emails; anyone already on it (now or before) is left alone.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['contacts'], properties: { contacts: { type: 'array', items: { type: 'string' }, maxItems: 100 }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ enrolled }`' }, 409: { description: 'The sequence is not active.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const sequence = await getProjectSequence(project, getRouterParam(event, 'id') || '')
  if (sequence.get('status') !== 'active') throw createError({ statusCode: 409, statusMessage: 'Activate the sequence first' })
  const ids = (Array.isArray(body.contacts) ? body.contacts : []).map(String).slice(0, 100)
  const contacts = ids.length ? await contactQuery(project).containedIn('objectId', ids).equalTo('subscription', 'subscribed').find(MASTER) : []
  let enrolled = 0
  for (const contact of contacts) if (await enrollContact(sequence, contact)) enrolled++
  return { enrolled }
})
