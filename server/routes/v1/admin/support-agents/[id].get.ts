defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Get an AI support agent', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ agent, llm, readiness }: `readiness.checks` is what the assistant still needs before it answers customers by itself (`llm`, `knowledge`, `active`, `autoReply`), `readiness.live` whether it does.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const route = await resolveAi(ctx.workspace, { assistant: agent })
  // Never leak the key; just say whether one is effectively configured, and whose.
  return { agent: serializeSupportAgent(agent), llm: { configured: !!route, model: route?.model || '', source: route?.source || null, usingDefaultEndpoint: !agent.get('endpoint') }, readiness: await readAssistant(ctx.workspace, agent) }
})
