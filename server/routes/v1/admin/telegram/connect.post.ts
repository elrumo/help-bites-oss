defineRouteMeta({
  openAPI: {
    tags: ['Telegram'], operationId: 'connectTelegram', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Connect Telegram',
    description: 'Checks the bot token, finds the chat (`chatId`, or the chat that last wrote to the bot) and sends it a hello. Error alerts are then sent there too. The token is stored sealed when the server has HELPBITES_SECRET.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'botToken'], properties: { project: { type: 'string' }, botToken: { type: 'string' }, chatId: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ connection }`' }, 400: { description: 'Bad token or chat, or nobody has written to the bot yet.' }, 502: { description: 'Telegram refused the request.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  return { connection: await connectTelegram(project, body.botToken, body.chatId) }
})
