defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'eraseContact', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Erase a contact',
    description: 'Removes the person and everything they left in the project: feedback, conversations, the mail log for their address and sequence enrollments (the same as `DELETE /v1/end-users/{externalId}`). Someone who had unsubscribed stays on the suppression list, so an import can never mail them again.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ erased: { …counts } }`' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const row = await getProjectContact(project, getRouterParam(event, 'id') || '')
  return { erased: await eraseEndUserData(project, row) }
})
