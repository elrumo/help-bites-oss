defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List conversation types for a project', operationId: 'listConversationTypes', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Returns persisted project types plus the implicit `support` preset when it has not been customized.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'project_123' } }], responses: { 200: { description: 'Configured types.', content: { 'application/json': { schema: { type: 'object', required: ['types'], properties: { types: { type: 'array', items: { '$ref': '#/components/schemas/ConversationType' } } } } } } }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project not found.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const rows = await new (useParse()).Query('ConversationType').equalTo('project', project).ascending('key').find(MASTER)
  // Support exists for every project, even ones created before ConversationType.
  const types = rows.map(serializeConversationType)
  if (!types.some(type => type.key === 'support')) types.unshift({ ...SUPPORT_TYPE, projectId: project.id || '' })
  return { types }
})
