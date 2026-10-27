defineRouteMeta({
  openAPI: {
    tags: ['Telegram'], operationId: 'disconnectTelegram', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Disconnect Telegram',
    description: 'Forgets the bot token and chat.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ disconnected: true }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  await disconnectTelegram(await requireProject(ctx, String(getQuery(event).project || '')))
  return { disconnected: true }
})
