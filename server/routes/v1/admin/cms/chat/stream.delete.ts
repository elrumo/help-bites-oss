defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'Stop a running assistant turn', operationId: 'stopCmsChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'What the turn already changed stays, and its reply so far is saved. With `message` (the question\'s id), a turn not started yet stops as soon as it does.', parameters: [{ name: 'message', in: 'query', schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'entry', in: 'query', schema: { type: 'string' } }, { name: 'component', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '`{ ok: true }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const scope = await cmsAiScope(ctx, event)
  const { message } = getQuery(event)
  await stopEmailAiRun(cmsRunKey(scope), 'main', message ? emailChatId(message) : undefined)
  return { ok: true }
})
