defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Update an AI support agent', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ agent }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'assistants.manage' })
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  await applySupportAgentInput(ctx, agent, (await readBody(event).catch(() => ({}))) as Record<string, unknown>)
  await agent.save(null, MASTER)
  return { agent: serializeSupportAgent(agent) }
})
