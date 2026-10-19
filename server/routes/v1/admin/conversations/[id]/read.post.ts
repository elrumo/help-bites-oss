defineRouteMeta({
  openAPI: { tags: ['Agent'], summary: 'Mark read/unread (team side)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { read: { type: 'boolean', default: true } } } } } }, responses: { 200: { description: '{ conversation }' } } }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  // readBody resolves `undefined` (not a throw) for an empty body, so the .catch
  // never fires — default it. requestBody is optional: no body means "mark read".
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as { read?: boolean }
  await markRead(conversation, 'agent', body.read !== false)
  return { conversation: serializeConversation(conversation) }
})
