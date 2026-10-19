defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Rebuild the search index for a model',
    description: 'Re-indexes every FAQ in the model (regenerating embeddings when available). Runs in the background; watch the dashboard\'s "needs reindex" count.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ started }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const model = await scoped.knowledgeModel(ctx, getRouterParam(event, 'id') || '')
  await queueKnowledgeIndex(model, { all: true })
  return { started: true }
})
