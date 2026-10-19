defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Get a document with its version history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ document, versions }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const doc = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const faqCount = await countFaqsForDocument(doc.id || '')
  // Every version of a lineage lives in the same model, so pin the lookup to it.
  const versions = await new Parse.Query('KnowledgeDocument').equalTo('knowledgeModel', doc.get('knowledgeModel')).equalTo('lineageId', String(doc.get('lineageId') || '')).ascending('version').find(MASTER)
  return { document: { ...serializeKnowledgeDocument(doc), faqCount }, versions: versions.map(serializeKnowledgeDocument) }
})
