defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Get an FAQ with its source and agent access', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ faq, sourceDocument, agentIds }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const faq = await scoped.faq(ctx, getRouterParam(event, 'id') || '')
  const doc = faq.get('sourceDocument') as ParseObject | undefined
  let sourceDocument = null
  if (doc) {
    const full = await scoped.knowledgeDocument(ctx, pointerId(doc)).catch(() => null)
    if (full) sourceDocument = serializeKnowledgeDocument(full)
  }
  const agentIds = await agentsWithAccessToFaq(faq, ctx.workspace, ctx)
  return { faq: serializeFaq(faq), sourceDocument, agentIds }
})
