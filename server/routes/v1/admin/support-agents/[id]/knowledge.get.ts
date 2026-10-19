defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Inspect the knowledge an agent can currently reach', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ faqs, count }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const agentId = getRouterParam(event, 'id') || ''
  await scoped.supportAgent(ctx, agentId)
  const rows = await queryAccessibleFaqs(agentId, { statuses: ['active'], limit: 200 })
  const faqs = rows.map((f) => {
    const node = f.get('node') as ParseObject | undefined
    return {
      id: f.id || '',
      question: String(f.get('question') || ''),
      pathCache: node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : '',
      status: String(f.get('status') || ''),
      modelId: pointerId(f.get('knowledgeModel'))
    }
  })
  return { faqs, count: faqs.length }
})
