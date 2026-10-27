defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'removeEmailSuppression', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Mail an address again',
    description: 'Takes the address off the project\'s suppression list (for example when the user subscribes again).',
    parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ removed }`: false when the address was not on the list.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller, undefined, { can: 'marketing' })
  const email = getRouterParam(event, 'email', { decode: true }) || ''
  return { removed: await removeEmailSuppression(project, email) }
})
