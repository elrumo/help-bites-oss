defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Get an AI support agent', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ agent, llm }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const route = await resolveAi(ctx.workspace, { assistant: agent })
  // Never leak the key; just say whether one is effectively configured, and whose.
  return { agent: serializeSupportAgent(agent), llm: { configured: !!route, model: route?.model || '', source: route?.source || null, usingDefaultEndpoint: !agent.get('endpoint') } }
})
