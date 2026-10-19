defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'The AI designer chats for a template', operationId: 'listEmailChats', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ chats: [{ id, title, updatedAt, running }] }`, most recently asked first; `title` is the first question.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const template = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const [chats, run] = await Promise.all([listEmailChats(template), emailAiRun(template.id!)])
  return { chats: chats.map(chat => ({ ...chat, running: chat.id === run?.chatId })) }
})
