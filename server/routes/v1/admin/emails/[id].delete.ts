defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Delete an email template', operationId: 'deleteEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'A master still linked into projects is refused; detach or remove those first.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ ok: true }`' }, 409: { description: 'Master still in use.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const links = await new (useParse()).Query('EmailTemplate').equalTo('workspace', ctx.workspace).equalTo('master', row).count(MASTER)
  if (links) throw createError({ statusCode: 409, statusMessage: `Used by ${links} project${links === 1 ? '' : 's'}; detach or remove it there first` })
  await row.destroy(MASTER)
  return { ok: true }
})
