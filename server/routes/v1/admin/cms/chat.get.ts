defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'The Pages assistant\'s chat', operationId: 'getCmsChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'entry', in: 'query', schema: { type: 'string' } }, { name: 'component', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '`{ messages, streamId }`: AI SDK UI messages, oldest first; `streamId` is set while a turn is running (re-attach with GET /v1/admin/cms/chat/stream?id=).' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const scope = await cmsAiScope(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  // The run before the messages: a turn ending in between is then replayed or already stored, never both.
  const run = await emailAiRun(cmsRunKey(scope))
  const messages = await listCmsChat(scope)
  return { messages, streamId: run && !messages.some(m => m.id === run.messageId) ? run.streamId : null }
})
