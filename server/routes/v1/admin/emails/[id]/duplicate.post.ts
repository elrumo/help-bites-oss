defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Duplicate an email template', operationId: 'duplicateEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ template }`' } } } })

const COPIED = ['workspace', 'project', 'master', 'folder', 'description', 'document', 'variables', 'values']

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const source = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const row = new (useParse().Object.extend('EmailTemplate'))()
  for (const field of COPIED) if (source.get(field) !== undefined) row.set(field, source.get(field))
  const name = `${source.get('name') || 'Untitled email'} copy`
  row.set('name', name)
  row.set('key', await freeKey(pointerId(source.get('project')) || null, ctx.workspaceId, name))
  await row.save(null, MASTER)
  return { template: serializeEmailTemplate(row) }
})
