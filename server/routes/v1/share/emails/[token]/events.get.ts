defineRouteMeta({ openAPI: { tags: ['Email'], summary: 'Live saves on a shared template (SSE)', operationId: 'streamSharedEmailEvents', security: [{}], parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'An open `text/event-stream` of `email.updated`.' } } } })

export default defineEventHandler(async (event) => {
  const row = await findSharedEmail(event, getRouterParam(event, 'token') || '', 'view')
  return streamEmailEvents(event, row.id || '')
})
