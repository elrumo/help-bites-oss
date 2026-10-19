defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Duplicate a knowledge model', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ model }' }, 402: { description: 'The copy would pass the plan\'s knowledge model or FAQ limit.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const source = await scoped.knowledgeModel(ctx, getRouterParam(event, 'id') || '')
  const copy = await duplicateKnowledgeModel(source, ctx.agentId) // keeps the source's workspace
  return { model: serializeKnowledgeModel(copy) }
})
