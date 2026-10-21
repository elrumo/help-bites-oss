defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'getProjectEmailSetup', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Is this project\'s email set up?',
    description: 'What the project needs before its email works: a mailer on the server, a sender address and domain (the project\'s own, else the server\'s), the delivery webhook that brings bounces and opens back, and, for campaigns and sequences, a postal address and a sender the reputation guard has not paused. `sending` says mail can go out, `bulk` that campaigns and sequences can start. See docs/EMAIL.md.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: {
        description: 'The checks.',
        content: { 'application/json': { example: {
          sending: true, bulk: false,
          checks: [
            { key: 'mailer', state: 'ok', scope: 'all', value: '' },
            { key: 'sender', state: 'ok', scope: 'all', value: 'hello@mail.acme.app' },
            { key: 'webhook', state: 'warn', scope: 'all', value: '' },
            { key: 'postalAddress', state: 'todo', scope: 'bulk', value: '' },
            { key: 'paused', state: 'ok', scope: 'bulk', value: '' }
          ]
        } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return projectEmailSetup(await requireProject(ctx, getRouterParam(event, 'id') || ''))
})
