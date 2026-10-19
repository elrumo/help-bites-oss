defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Remove a knowledge assignment', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'assignmentId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'assistants.manage' })
  const Parse = useParse()
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const id = getRouterParam(event, 'assignmentId') || ''
  const row = await new Parse.Query('AgentKnowledgeAssignment').get(id, MASTER).catch(() => null)
  // Only one of this (scoped) agent's own assignments.
  if (!row || pointerId(row.get('supportAgent')) !== agent.id) throw createError({ statusCode: 404, statusMessage: 'Assignment not found' })
  await row.destroy(MASTER)
  return { deleted: true }
})
