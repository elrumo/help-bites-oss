defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Import / document processing status', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ document }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const doc = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const faqCount = await countFaqsForDocument(doc.id || '')
  return { document: { ...serializeKnowledgeDocument(doc), faqCount } }
})
