defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Create an email component', operationId: 'createEmailComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Custom HTML with `{{@key}}` fields. `fields` describes each one (`{ key, label, type: text | richtext | url | image | color | number, group: content | style, default }`); slots without one become text fields. No `project` shares it with every project and master.', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name', 'html'], properties: { name: { type: 'string' }, description: { type: 'string' }, html: { type: 'string' }, fields: { type: 'array', items: { type: 'object' } }, project: { type: 'string' } } } } } }, responses: { 200: { description: '`{ component }`' }, 400: { description: 'Invalid component.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true, can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const row = new (useParse().Object.extend('EmailComponent'))()
  await applyEmailComponentInput(ctx, row, body)
  await row.save(null, MASTER)
  return { component: serializeEmailComponent(row) }
})
