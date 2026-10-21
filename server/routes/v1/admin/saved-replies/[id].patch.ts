defineRouteMeta({
  openAPI: {
    tags: ['Saved replies'], operationId: 'updateSavedReply', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a saved reply',
    description: 'Send only the keys to change: `title`, `body`, `shortcut` (an empty string clears it).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ reply }`' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' }, 409: { description: 'The shortcut is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.savedReply(ctx, getRouterParam(event, 'id') || '')
  return { reply: serializeSavedReply(await updateSavedReply(row, await readBody(event).catch(() => ({})))) }
})
