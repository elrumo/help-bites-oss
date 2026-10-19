defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Update a knowledge model', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ model }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const model = await scoped.knowledgeModel(ctx, getRouterParam(event, 'id') || '')
  applyKnowledgeModelInput(model, (await readBody(event).catch(() => ({}))) as Record<string, unknown>)
  await model.save(null, MASTER)
  return { model: serializeKnowledgeModel(model) }
})
