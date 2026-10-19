defineRouteMeta({ openAPI: { tags: ['Email'], summary: 'Edit a shared email template', operationId: 'updateSharedEmail', security: [{}], description: 'Only for links shared for editing. Takes `document`, `variables` and `actorId`. Each save records its time and IP for the operators.', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ template }`' }, 403: { description: 'View-only link.' }, 404: { description: 'Link revoked, expired or unknown.' } } } })

export default defineEventHandler(async (event) => {
  const { row } = await findSharedEmail(event, getRouterParam(event, 'token') || '', 'edit')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  await applyEmailInput(row, body, { shared: true })
  // Anyone holding the link can save, so operators see when and from where.
  row.set('lastSharedEdit', { at: new Date().toISOString(), ip: clientIp(event) })
  return { template: sharedEmailTemplate(await saveAndBroadcast(row)) }
})
