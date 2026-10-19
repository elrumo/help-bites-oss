defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Set an email template\'s share link', operationId: 'shareEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: '`view`: anyone with the link sees the rendered email. `edit`: anyone with the link can also change the design (not for masters, linked masters or mail the server sends itself). `off` revokes the link. Every `view` or `edit` call (re)starts the link\'s expiry: `expiresInDays` (1–90), by default 7 days for `edit` and 30 for `view`.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['off', 'view', 'edit'] }, expiresInDays: { type: 'integer', minimum: 1, maximum: 90 } } } } } }, responses: { 200: { description: '`{ mode, token, expiresAt }` (`expiresAt` in ms, null when off)' }, 400: { description: 'Invalid mode or expiry, or this template cannot be shared for editing.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const { mode, expiresInDays } = (await readBody(event).catch(() => ({}))) as { mode?: string, expiresInDays?: unknown }
  if (mode !== 'off' && mode !== 'view' && mode !== 'edit') throw createError({ statusCode: 400, statusMessage: 'mode must be off, view or edit' })
  const refusal = mode === 'edit' ? shareEditRefusal(serializeEmailTemplate(row)) : null
  if (refusal) throw createError({ statusCode: 400, statusMessage: refusal })
  if (mode === 'off') {
    row.unset('shareToken')
    row.unset('shareMode')
    row.unset('shareExpiresAt')
  } else {
    if (!row.get('shareToken')) row.set('shareToken', newShareToken())
    row.set('shareMode', mode)
    row.set('shareExpiresAt', shareExpiresAt(mode, expiresInDays))
  }
  await row.save(null, MASTER)
  return { mode, token: (row.get('shareToken') as string) || null, expiresAt: (row.get('shareExpiresAt') as Date | undefined)?.getTime() ?? null }
})
