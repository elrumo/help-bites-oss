defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Test retrieval for an agent',
    description: 'Runs the same retrieval the support runtime uses: returns the knowledge this agent would be given for a query, respecting its assignments and FAQ status.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'number' } } } } } },
    responses: { 200: { description: '{ results }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const agentId = getRouterParam(event, 'id') || ''
  await scoped.supportAgent(ctx, agentId)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const query = String(body.query || '').trim()
  if (!query) throw createError({ statusCode: 400, statusMessage: 'query is required' })
  const results = await retrieveKnowledge(agentId, query, { limit: Math.min(Math.max(Number(body.limit) || 8, 1), 20) })
  return { results }
})
