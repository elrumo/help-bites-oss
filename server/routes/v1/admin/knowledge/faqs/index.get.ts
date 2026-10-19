import { faqAllowed, type FaqLite } from '#shared/knowledge'

defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'List / search / filter FAQs',
    description: 'Filters: modelId, nodeId, status, origin, sourceDocumentId, language. Full-text q uses Meilisearch when available. Offset pagination (limit, skip).',
    responses: { 200: { description: '{ faqs, total, hasMore }' } }
  }
})

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const q = getQuery(event)
  const modelId = String(q.modelId || '')
  // One of the caller's models, or else all of them (never the whole install).
  const models = modelId ? [await scoped.knowledgeModel(ctx, modelId)] : await limitToKeyProjects(ctx, new Parse.Query('KnowledgeModel')).equalTo('workspace', ctx.workspace).select('objectId').limit(1000).find(MASTER)
  const nodeId = String(q.nodeId || '')
  const status = String(q.status || '')
  const origin = String(q.origin || '')
  const documentId = String(q.sourceDocumentId || '')
  const language = String(q.language || '')
  const search = String(q.q || '').trim()
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
  const skip = Math.max(Number(q.skip) || 0, 0)

  let rows: ParseObject[] = []
  let total = 0

  if (search && meiliConfigured() && modelId) {
    const filters: string[] = [`modelId = ${JSON.stringify(modelId)}`]
    if (status) filters.push(`status = ${JSON.stringify(status)}`)
    if (nodeId) filters.push(`nodeId = ${JSON.stringify(nodeId)}`)
    if (language) filters.push(`language = ${JSON.stringify(language)}`)
    const hits = await searchIndex(KNOWLEDGE_INDEX, search, { filter: filters, limit: skip + limit })
    const ids = hits.slice(skip, skip + limit).map((h: any) => String(h.id))
    const found = ids.length ? await new Parse.Query('Faq').include('node').containedIn('objectId', ids).containedIn('knowledgeModel', models).find(MASTER) : []
    const byId = new Map(found.map(r => [r.id || '', r]))
    rows = ids.map(id => byId.get(id)).filter(Boolean) as ParseObject[]
    total = hits.length
  } else {
    const build = () => {
      const query = new Parse.Query('Faq').containedIn('knowledgeModel', models)
      if (nodeId) query.equalTo('node', Parse.Object.extend('KnowledgeNode').createWithoutData(nodeId))
      if (status) query.equalTo('status', status)
      if (origin) query.equalTo('origin', origin)
      if (language) query.equalTo('language', language)
      if (documentId) query.equalTo('sourceDocument', Parse.Object.extend('KnowledgeDocument').createWithoutData(documentId))
      if (search) query.matches('question', escapeRegex(search), 'i')
      return query
    }
    total = await build().count(MASTER)
    rows = await build().include('node').descending('updatedAt').skip(skip).limit(limit).find(MASTER)
  }

  // Which of this workspace's agents can currently reach each FAQ (resolve each agent's filter once).
  const agents = await limitToKeyProjects(ctx, new Parse.Query('SupportAgent')).equalTo('workspace', ctx.workspace).limit(1000).find(MASTER)
  const agentFilters = await Promise.all(agents.map(async a => ({ id: a.id || '', name: String(a.get('name') || ''), ...(await resolveAgentFilter(a.id || '')) })))
  const agentsFor = (row: ParseObject) => {
    const node = row.get('node') as ParseObject | undefined
    const lite: FaqLite = { id: row.id || '', modelId: pointerId(row.get('knowledgeModel')), pathCache: node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : '', status: String(row.get('status') || ''), language: String(row.get('language') || '') }
    return agentFilters.filter(af => faqAllowed(lite, af.filter)).map(af => ({ id: af.id, name: af.name }))
  }

  return {
    faqs: rows.map(r => ({ ...serializeFaq(r), agents: agentsFor(r) })),
    total,
    hasMore: skip + rows.length < total
  }
})
