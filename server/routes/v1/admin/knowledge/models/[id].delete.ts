defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Delete a knowledge model (cascades)',
    description: 'Without ?confirm=true, returns the impact instead of deleting. Prefer archiving via PATCH status=archived.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'confirm', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '{ deleted, impact? }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const model = await scoped.knowledgeModel(ctx, getRouterParam(event, 'id') || '')
  const modelId = model.id || ''
  if (String(getQuery(event).confirm) !== 'true') {
    const d = await modelDashboard(modelId)
    return { deleted: false, impact: { faqs: d.faqsTotal, nodes: d.nodes, documents: d.documents, agents: d.agents } }
  }
  await deleteModelCascade(modelId)
  return { deleted: true }
})
