defineRouteMeta({
  openAPI: {
    tags: ['Telegram'], operationId: 'getTelegramConnection', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Is Telegram connected?',
    description: 'The project\'s Telegram bot and chat. The token is never returned.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ connection, ready }`. `ready` is false until HELPBITES_SECRET is set on the server.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await requireProject(ctx, String(getQuery(event).project || ''))
  return { connection: serializeTelegram(project), ready: hasRootSecret() }
})
