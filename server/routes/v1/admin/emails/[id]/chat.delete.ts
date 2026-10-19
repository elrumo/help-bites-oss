defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Delete an AI designer chat', operationId: 'clearEmailChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'chat', in: 'query', required: false, schema: { type: 'string' }, description: 'Which chat; the most recent one when left out. A turn it has running is stopped first.' }], responses: { 200: { description: '`{ ok: true }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const template = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const asked = getQuery(event).chat
  const chatId = asked ? emailChatId(asked) : await latestEmailChatId(template)
  if (chatId) {
    await stopEmailAiRun(template.id!, chatId)
    await deleteEmailChat(template, chatId)
  }
  return { ok: true }
})
