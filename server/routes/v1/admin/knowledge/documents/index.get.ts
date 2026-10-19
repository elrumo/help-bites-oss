defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'List uploaded documents', parameters: [{ name: 'modelId', in: 'query', schema: { type: 'string' } }, { name: 'all', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '{ documents }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const q = getQuery(event)
  const query = new Parse.Query('KnowledgeDocument').descending('createdAt').limit(500)
  if (q.modelId) query.equalTo('knowledgeModel', await scoped.knowledgeModel(ctx, String(q.modelId)))
  else query.containedIn('knowledgeModel', await limitToKeyProjects(ctx, new Parse.Query('KnowledgeModel')).equalTo('workspace', ctx.workspace).select('objectId').limit(1000).find(MASTER))
  if (String(q.all) !== '1') query.equalTo('isCurrent', true)
  const rows = await query.find(MASTER)
  const documents = await Promise.all(rows.map(async d => ({ ...serializeKnowledgeDocument(d), faqCount: await countFaqsForDocument(d.id || '') })))
  return { documents }
})
