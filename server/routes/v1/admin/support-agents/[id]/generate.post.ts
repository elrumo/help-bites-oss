defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Generate a test answer from an assistant',
    description: 'Runs the same retrieval + grounded generation the support runtime uses, so an operator can see how an assistant would answer a question. Does not touch any conversation.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string', example: 'How do I delete my account?' } } } } } },
    responses: { 200: { description: '{ answer, model, knowledge }' }, 400: { description: 'Missing query or no LLM endpoint configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const query = String(body.query || '').trim()
  if (!query) throw createError({ statusCode: 400, statusMessage: 'query is required' })

  if (!(await resolveAi(ctx.workspace, { assistant: agent }))) throw createError({ statusCode: 400, statusMessage: 'This assistant has no LLM endpoint configured.' })

  const knowledge = await retrieveKnowledge(agent.id || '', query, { limit: 6 })
  const { text, model } = await generateAnswer({ agent, query, knowledge })
  return { answer: text, model, knowledge: knowledge.map(k => ({ faqId: k.faqId, question: k.question, pathCache: k.pathCache, score: k.score })) }
})
