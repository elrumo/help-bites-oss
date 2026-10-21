defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'Clear the Pages assistant\'s chat', operationId: 'clearCmsChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'entry', in: 'query', schema: { type: 'string' } }, { name: 'component', in: 'query', schema: { type: 'string' } }], description: 'A turn still running is stopped first. What it changed stays.', responses: { 200: { description: '`{ ok: true }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const scope = await cmsAiScope(ctx, event)
  await stopEmailAiRun(cmsRunKey(scope), 'main')
  await deleteCmsChat(scope)
  return { ok: true }
})
