defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Live template saves (SSE)', operationId: 'streamEmailTemplateEvents', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: '`email.updated` with the saved template after every save, and `ping` every few seconds.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'An open `text/event-stream`.' } } } })

export default defineEventHandler(async (event) => {
  const row = await scoped.emailTemplate(await requireMember(event), getRouterParam(event, 'id') || '')
  return streamEmailEvents(event, row.id || '')
})
