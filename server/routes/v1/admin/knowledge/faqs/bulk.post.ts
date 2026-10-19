import { FAQ_STATUSES } from '#shared/knowledge'

defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Bulk FAQ actions',
    description: 'action: status | move | tag | delete over up to 500 ids.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['ids', 'action'], properties: {
      ids: { type: 'array', items: { type: 'string' } }, action: { type: 'string' }, status: { type: 'string' }, nodeId: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }
    } } } } },
    responses: { 200: { description: '{ affected }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const Parse = useParse()
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 500) : []
  const action = String(body.action || '')
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'ids is required' })

  // Only FAQs of this workspace's models: any other id is skipped, like one that does not exist.
  const workspaceModels = await limitToKeyProjects(ctx, new Parse.Query('KnowledgeModel')).equalTo('workspace', ctx.workspace).select('objectId').limit(1000).find(MASTER)
  const rows = await new Parse.Query('Faq').containedIn('objectId', ids).containedIn('knowledgeModel', workspaceModels).limit(500).find(MASTER)
  const models = new Set<string>()
  rows.forEach(r => models.add(pointerId(r.get('knowledgeModel'))))

  if (action === 'delete') {
    await Parse.Object.destroyAll(rows, MASTER)
    if (meiliConfigured()) await deleteDocuments(KNOWLEDGE_INDEX, rows.map(r => r.id || '')).catch(() => {})
    return { affected: rows.length }
  }

  if (action === 'status') {
    const status = String(body.status || '')
    if (!(FAQ_STATUSES as readonly string[]).includes(status)) throw createError({ statusCode: 400, statusMessage: 'invalid status' })
    rows.forEach(r => { r.set('status', status); r.set('needsReindex', true) })
  } else if (action === 'move') {
    const nodeId = String(body.nodeId || '')
    if (nodeId) await scoped.knowledgeNode(ctx, nodeId)
    for (const r of rows) await setFaqNode(r, nodeId)
  } else if (action === 'tag') {
    const add = (Array.isArray(body.tags) ? body.tags : []).map(t => String(t).trim().slice(0, 120)).filter(Boolean)
    rows.forEach(r => {
      const existing: string[] = Array.isArray(r.get('tags')) ? r.get('tags') : []
      r.set('tags', [...new Set([...existing, ...add])].slice(0, 40))
    })
  } else {
    throw createError({ statusCode: 400, statusMessage: 'action must be status, move, tag or delete' })
  }

  await Parse.Object.saveAll(rows, MASTER)
  for (const modelId of models) if (modelId) await queueKnowledgeIndex(modelId)
  return { affected: rows.length }
})
