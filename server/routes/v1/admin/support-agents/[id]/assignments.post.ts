defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Grant (or exclude) knowledge for an agent',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['scope'], properties: {
      scope: { type: 'string', enum: ['model', 'path', 'faq'] }, modelId: { type: 'string' }, nodeId: { type: 'string' }, faqId: { type: 'string' }, exclude: { type: 'boolean' }
    } } } } },
    responses: { 200: { description: '{ assignment }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'assistants.manage' })
  const agentId = getRouterParam(event, 'id') || ''
  await scoped.supportAgent(ctx, agentId) // 404 unless it is the caller's
  const assignment = await createAssignment(ctx, agentId, (await readBody(event).catch(() => ({}))) as Record<string, unknown>)
  return { assignment: serializeAssignment(assignment) }
})
