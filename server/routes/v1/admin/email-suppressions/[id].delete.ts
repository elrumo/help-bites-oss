defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminRemoveEmailSuppression', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Remove a suppressed address',
    description: 'The project mails the address again.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const row = await new (useParse()).Query('EmailSuppression').get(getRouterParam(event, 'id') || '', MASTER).catch(() => null)
  await assertProjectRow(ctx, row, 'Suppression not found')
  await row!.destroy(MASTER)
  return { ok: true }
})
