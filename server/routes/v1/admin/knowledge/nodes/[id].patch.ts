defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Rename, move or reorder a node',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
      name: { type: 'string' }, description: { type: 'string' }, order: { type: 'number' }, parentId: { type: 'string', description: 'Empty string moves to root' }
    } } } } },
    responses: { 200: { description: '{ node }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const node = await scoped.knowledgeNode(ctx, getRouterParam(event, 'id') || '')
  const modelId = pointerId(node.get('knowledgeModel'))
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  // A foreign parent is a 404; updateKnowledgeNode then checks it is in this model.
  if (body.parentId) await scoped.knowledgeNode(ctx, String(body.parentId))
  const changed = await updateKnowledgeNode(node, body)

  // A moved/renamed node changes its subtree's pathCache, so the FAQs beneath
  // those nodes need re-indexing.
  if (changed.length) {
    const Parse = useParse()
    const nodes = changed.map(id => Parse.Object.extend('KnowledgeNode').createWithoutData(id))
    await eachBatch(() => new Parse.Query('Faq').containedIn('node', nodes), async (faqs) => {
      for (const f of faqs) f.set('needsReindex', true)
      await Parse.Object.saveAll(faqs, MASTER)
    }, { keys: ['objectId'] })
    await queueKnowledgeIndex(modelId)
  }
  return { node: serializeKnowledgeNode(await scoped.knowledgeNode(ctx, node.id || '')) }
})
