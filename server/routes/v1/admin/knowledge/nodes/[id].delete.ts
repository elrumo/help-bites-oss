defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Delete a node (children and FAQs move up)',
    description: 'Without ?confirm=true, returns the impact. Children are reparented and FAQs move to the parent — nothing is cascade-deleted.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'confirm', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '{ deleted, impact? }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const node = await scoped.knowledgeNode(ctx, getRouterParam(event, 'id') || '')
  const modelId = pointerId(node.get('knowledgeModel'))
  if (String(getQuery(event).confirm) !== 'true') {
    return { deleted: false, impact: await nodeImpact(node) }
  }
  await deleteKnowledgeNode(node)
  await queueKnowledgeIndex(modelId)
  return { deleted: true }
})
