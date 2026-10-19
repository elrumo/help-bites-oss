defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Delete an email component', operationId: 'deleteEmailComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Emails that use it keep their copy.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ ok: true }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true, can: 'content' })
  const row = await scoped.emailComponent(ctx, getRouterParam(event, 'id') || '')
  await row.destroy(MASTER)
  return { ok: true }
})
