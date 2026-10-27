defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'addEmailSuppressions', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Stop mailing addresses',
    description: 'For example when a user unsubscribes in your app. Addresses already on the list keep their first reason.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['emails'], properties: { emails: { type: 'array', items: { type: 'string' }, maxItems: 1000 }, reason: { type: 'string', enum: ['unsubscribe', 'manual', 'bounce', 'complaint'] }, detail: { type: 'string' }, project: { type: 'string', description: 'Operators and admin keys only.' } } }, example: { emails: ['ada@example.com'], reason: 'unsubscribe' } } } },
    responses: { 200: { description: '`{ added: [suppression], existing }`' }, 400: { description: 'Missing or invalid addresses.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const project = await callerProject(event, caller, body.project, { can: 'marketing' })
  const input = readSuppressionInput(body)
  return addEmailSuppressions(project, input.emails.map(email => ({ email, reason: input.reason, detail: input.detail, source: caller.source === 'api' ? 'api' : 'admin' })))
})
