defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Set an email template\'s share link', operationId: 'shareEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: '`view`: anyone with the link sees the rendered email. `edit`: anyone with the link can also change the design (not for linked masters). `off` revokes the link.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['off', 'view', 'edit'] } } } } } }, responses: { 200: { description: '`{ mode, token }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const { mode } = (await readBody(event).catch(() => ({}))) as { mode?: string }
  if (mode !== 'off' && mode !== 'view' && mode !== 'edit') throw createError({ statusCode: 400, statusMessage: 'mode must be off, view or edit' })
  if (mode === 'edit' && row.get('master')) throw createError({ statusCode: 400, statusMessage: 'A linked master can only be shared view-only; edit the master instead' })
  if (mode === 'off') {
    row.unset('shareToken')
    row.unset('shareMode')
  } else {
    if (!row.get('shareToken')) row.set('shareToken', newShareToken())
    row.set('shareMode', mode)
  }
  await row.save(null, MASTER)
  return { mode, token: (row.get('shareToken') as string) || null }
})
