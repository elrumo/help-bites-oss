defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Create a path node',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['modelId', 'name'], properties: {
      modelId: { type: 'string' }, name: { type: 'string' }, parentId: { type: 'string' }, description: { type: 'string' }
    } } } } },
    responses: { 200: { description: '{ node }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const modelId = String(body.modelId || '')
  if (!modelId) throw createError({ statusCode: 400, statusMessage: 'modelId is required' })
  await scoped.knowledgeModel(ctx, modelId)
  // A foreign parent is a 404; createKnowledgeNode then checks it is in this model.
  if (body.parentId) await scoped.knowledgeNode(ctx, String(body.parentId))
  const node = await createKnowledgeNode(modelId, { name: String(body.name || ''), parentId: body.parentId ? String(body.parentId) : undefined, description: body.description ? String(body.description) : undefined })
  return { node: serializeKnowledgeNode(node) }
})
