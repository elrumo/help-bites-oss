defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Unified search across conversations and knowledge',
    description: 'Meilisearch-backed. type: conversations | faqs | all (default). Empty when Meilisearch is not configured.',
    parameters: [
      { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'type', in: 'query', schema: { type: 'string' } }
    ],
    responses: { 200: { description: '{ conversations, endUsers, faqs }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const q = getQuery(event)
  const term = String(q.q || '').trim()
  const only = q.project ? await requireProject(ctx, String(q.project)) : null
  const projectId = only?.id || ''
  const type = String(q.type || 'all')
  const out: { conversations: any[], endUsers: Record<string, any>, faqs: any[] } = { conversations: [], endUsers: {}, faqs: [] }
  if (!term || !meiliConfigured()) return out

  if (type === 'all' || type === 'conversations') {
    try {
      const ids = await searchConversationIds(term, { workspaceId: ctx.workspaceId, projectId }, 20)
      if (ids.length) {
        const rows = await new Parse.Query('Conversation').include('endUser').containedIn('project', only ? [only] : await projectPointers(ctx)).containedIn('objectId', ids).find(MASTER)
        const byId = new Map(rows.map(r => [r.id || '', r]))
        out.conversations = (ids.map(id => byId.get(id)).filter(Boolean) as ParseObject[]).map((c) => {
          const endUser = c.get('endUser') as ParseObject | undefined
          if (endUser && typeof endUser.get === 'function') out.endUsers[endUser.id || ''] = serializeEndUser(endUser)
          return serializeConversation(c)
        })
      }
    } catch (error) { console.warn('[search] conversations failed:', (error as Error).message) }
  }

  if (type === 'all' || type === 'faqs') {
    try {
      // Knowledge belongs to the workspace (a model need not have a project), so ?project does not narrow it.
      const hits = await searchIndex(KNOWLEDGE_INDEX, term, { filter: `workspaceId = ${JSON.stringify(ctx.workspaceId)}`, limit: 20 })
      const ids = hits.map((h: any) => String(h.id))
      if (ids.length) {
        const models = limitToKeyProjects(ctx, new Parse.Query('KnowledgeModel')).equalTo('workspace', ctx.workspace)
        const rows = await new Parse.Query('Faq').include('node').matchesQuery('knowledgeModel', models).containedIn('objectId', ids).find(MASTER)
        const byId = new Map(rows.map(r => [r.id || '', r]))
        out.faqs = (ids.map(id => byId.get(id)).filter(Boolean) as ParseObject[]).map(serializeFaq)
      }
    } catch (error) { console.warn('[search] faqs failed:', (error as Error).message) }
  }

  return out
})
