defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'installAutomationRecipe', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Install an automation recipe',
    description: 'Creates a **draft** sequence and its emails in the project. Read and edit them, then activate the sequence with `PATCH /v1/sequences/{id} { "status": "active" }` (activation checks every email for an unsubscribe link and your postal address). Only subscribed contacts are emailed.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ sequence }`' }, 402: { description: 'The plan does not include sequences.' }, 404: { description: 'No such recipe.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>
  const project = await callerProject(event, caller, body?.project, { can: 'marketing' })
  return { sequence: await installRecipe(project, requireRecipe(getRouterParam(event, 'id') || '')) }
})
