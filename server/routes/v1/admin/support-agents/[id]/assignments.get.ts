defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List an agent\'s knowledge assignments', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ assignments }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const rows = await listAssignments(agent.id || '')
  return { assignments: rows.map(serializeAssignment) }
})
