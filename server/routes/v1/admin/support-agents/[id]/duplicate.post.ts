defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Duplicate an AI support agent (with its assignments; API key is not copied)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ agent }' }, 402: { description: 'The plan\'s assistant limit is reached.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'assistants.manage' })
  const { agentId } = ctx
  const Parse = useParse()
  const source = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  await checkGauge(ctx.workspace, 'assistants')

  const copy = new (Parse.Object.extend('SupportAgent'))()
  for (const key of ['description', 'systemPrompt', 'model', 'endpoint', 'temperature', 'fallbackBehavior']) {
    if (source.get(key) !== undefined) copy.set(key, source.get(key))
  }
  copy.set('name', `${String(source.get('name') || 'Agent')} (copy)`)
  copy.set('status', 'draft')
  copy.set('autoReply', false) // never auto-enable a copy
  copy.set('workspace', source.get('workspace'))
  if (source.get('project')) copy.set('project', source.get('project'))
  if (agentId) copy.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
  await copy.save(null, MASTER)

  const assignments = await new Parse.Query('AgentKnowledgeAssignment').equalTo('supportAgent', source).limit(1000).find(MASTER)
  const clones = assignments.map((a) => {
    const c = new (Parse.Object.extend('AgentKnowledgeAssignment'))()
    c.set('supportAgent', copy)
    for (const key of ['knowledgeModel', 'node', 'faq', 'scope', 'exclude']) if (a.get(key) !== undefined) c.set(key, a.get(key))
    return c
  })
  if (clones.length) await Parse.Object.saveAll(clones, MASTER)
  return { agent: serializeSupportAgent(copy) }
})
