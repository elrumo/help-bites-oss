defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'getContact', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One contact',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The contact id. Look people up by your own id with `GET /v1/contacts?externalId=`.' }, { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Operators and admin keys only.' }],
    responses: { 200: { description: '`{ contact }`', content: { 'application/json': { schema: { type: 'object', properties: { contact: { '$ref': '#/components/schemas/Contact' } } } } } }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  return { contact: serializeContact(await getProjectContact(project, getRouterParam(event, 'id') || '')) }
})
