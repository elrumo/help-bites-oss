defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminGetEmailLog', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One email log entry',
    description: 'With its delivery events, and the message\'s HTML and text when the project keeps message content.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ log }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return { log: serializeEmailLog(await scoped.emailLog(ctx, getRouterParam(event, 'id') || ''), { content: true }) }
})
