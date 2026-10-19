defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'An AI designer chat for a template', operationId: 'getEmailChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'chat', in: 'query', required: false, schema: { type: 'string' }, description: 'Which chat; the most recent one when left out.' }], responses: { 200: { description: '`{ chatId, messages, streamId }`: `messages` as AI SDK UI messages, oldest first; `chatId` is null before anyone has asked anything; `streamId` is set while the chat has a turn running (re-attach with GET …/chat/stream?id=).' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const template = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const asked = getQuery(event).chat
  const chatId = asked ? emailChatId(asked) : await latestEmailChatId(template)
  if (!chatId) return { chatId: null, messages: [], streamId: null }
  // The run before the messages: a turn ending in between is then either
  // replayed or already stored, never both.
  const run = await emailAiRun(template.id!)
  const messages = await listEmailChat(template, chatId)
  const running = run?.chatId === chatId && !messages.some(m => m.id === run.messageId)
  return { chatId, messages, streamId: running ? run.streamId : null }
})
