defineRouteMeta({ openAPI: { tags: ['Email'], summary: 'Edit a shared email template', operationId: 'updateSharedEmail', security: [{}], description: 'Only for links shared for editing. Takes `document`, `variables` and `actorId`.', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ template }`' }, 403: { description: 'View-only link.' } } } })

export default defineEventHandler(async (event) => {
  const row = await findSharedEmail(event, getRouterParam(event, 'token') || '', 'edit')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  await applyEmailInput(row, body, { shared: true })
  const template = await saveAndBroadcast(row)
  return { template: { ...template, shareToken: null } }
})
