defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Update an email component', operationId: 'updateEmailComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Changes the library only: emails that already use the component keep their copy until they update from the library. `project: null` shares a project\'s component.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, html: { type: 'string' }, fields: { type: 'array', items: { type: 'object' } }, project: { type: 'string', nullable: true } } } } } }, responses: { 200: { description: '`{ component }`' }, 400: { description: 'Invalid component.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true, can: 'content' })
  const row = await scoped.emailComponent(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  await applyEmailComponentInput(ctx, row, body)
  await row.save(null, MASTER)
  return { component: serializeEmailComponent(row) }
})
