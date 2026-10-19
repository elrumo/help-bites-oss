defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Stop a running AI designer turn', operationId: 'stopEmailChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'What the turn already changed stays, and its reply so far is saved. With `message` (the question\'s id), a turn the server hasn\'t started yet stops as soon as it does.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'chat', in: 'query', required: true, schema: { type: 'string' } }, { name: 'message', in: 'query', required: false, schema: { type: 'string' } }], responses: { 200: { description: '`{ ok: true }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const template = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const { chat, message } = getQuery(event)
  await stopEmailAiRun(template.id!, emailChatId(chat), message ? emailChatId(message) : undefined)
  return { ok: true }
})
