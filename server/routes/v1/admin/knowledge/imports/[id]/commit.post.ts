defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Commit reviewed import entries',
    description: 'Creates/updates FAQs from the reviewed entries (matched by importKey, so re-imports do not duplicate), then indexes in the background.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['entries'], properties: {
      entries: { type: 'array', items: { type: 'object', properties: { path: { type: 'array', items: { type: 'string' } }, question: { type: 'string' }, answer: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } } } } }
    } } } } },
    responses: { 200: { description: '{ stats }' }, 402: { description: 'The FAQs it would create pass the plan\'s FAQ limit; nothing is written.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agentId } = ctx
  const doc = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const rawEntries = Array.isArray(body.entries) ? body.entries : []
  if (!rawEntries.length) throw createError({ statusCode: 400, statusMessage: 'entries is required' })

  const entries = rawEntries.map((e: any) => ({
    path: Array.isArray(e?.path) ? e.path.map((p: unknown) => String(p || '')) : [],
    question: String(e?.question || ''),
    answer: String(e?.answer || ''),
    aliases: Array.isArray(e?.aliases) ? e.aliases.map((a: unknown) => String(a || '')) : undefined,
    tags: Array.isArray(e?.tags) ? e.tags.map((t: unknown) => String(t || '')) : undefined
  })).filter(e => e.question.trim())

  const stats = await commitImport(doc, entries, agentId, ctx.workspace)
  await setDocumentStatus(doc, 'processing', { stats })
  await queueKnowledgeIndex(pointerId(doc.get('knowledgeModel')), { documentId: doc.id || '' })
  return { stats }
})
