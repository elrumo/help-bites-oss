defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Create an AI support agent',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, description: { type: 'string' }, projectId: { type: 'string' }, systemPrompt: { type: 'string' }, model: { type: 'string' }, endpoint: { type: 'string' }, apiKey: { type: 'string' }, temperature: { type: 'number' }, autoReply: { type: 'boolean' }, fallbackBehavior: { type: 'string' }, minConfidence: { type: 'number', description: 'Min top-match score (0..1) before an AI answer is sent; 0 = no gate.' }, defaultAction: { type: 'string', enum: ['auto', 'human'], description: 'What to do when no rule matches.' }, rules: { type: 'array', description: 'Ordered routing rules; first match decides auto vs human.', items: { type: 'object', properties: { conversationType: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['auto', 'human'] } } } }
    } } } } },
    responses: { 200: { description: '{ agent }' }, 402: { description: 'The plan\'s assistant limit is reached.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'assistants.manage' })
  const { agentId } = ctx
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (typeof body.name !== 'string' || !body.name.trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  await checkGauge(ctx.workspace, 'assistants')

  const Parse = useParse()
  const agent = new (Parse.Object.extend('SupportAgent'))()
  agent.set('status', 'draft')
  agent.set('autoReply', false)
  agent.set('fallbackBehavior', 'human')
  agent.set('temperature', 0.2)
  if (agentId) agent.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
  await applySupportAgentInput(ctx, agent, body) // sets the workspace and checks projectId
  await agent.save(null, MASTER)
  return { agent: serializeSupportAgent(agent) }
})
