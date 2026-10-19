defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Update an email template', operationId: 'updateEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Partial. A linked row takes `name`, `key`, `folder` and `variableValues`; its design is the master\'s. `actorId` (the saving tab) comes back in the live event so that tab can skip its own save.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, key: { type: 'string' }, description: { type: 'string' }, document: { type: 'object' }, variables: { type: 'array' }, variableValues: { type: 'object' }, folder: { type: 'string', nullable: true }, actorId: { type: 'string' } } } } } }, responses: { 200: { description: '`{ template }`' }, 409: { description: 'Key already used in this project.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  await applyEmailInput(row, body)
  return { template: await saveAndBroadcast(row) }
})
