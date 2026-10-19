defineRouteMeta({
  openAPI: { tags: ['Agent'], summary: 'Unsend a team message', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted: true }' } } }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const message = await scoped.message(ctx, getRouterParam(event, 'id') || '')
  if (message.get('sender') !== 'agent') throw createError({ statusCode: 403, statusMessage: 'Only team messages can be unsent here' })
  await deleteMessage(message)
  return { deleted: true }
})
