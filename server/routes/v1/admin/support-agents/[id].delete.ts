defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Delete an AI support agent', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'assistants.manage' })
  const Parse = useParse()
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const assignments = await new Parse.Query('AgentKnowledgeAssignment').equalTo('supportAgent', agent).limit(1000).find(MASTER)
  if (assignments.length) await Parse.Object.destroyAll(assignments, MASTER)
  await agent.destroy(MASTER)
  return { deleted: true }
})
