defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Get an email template', operationId: 'getEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ template }`' }, 404: { description: 'Not found.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return { template: serializeEmailTemplate(await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')) }
})
