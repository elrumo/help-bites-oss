import { parseFaqMarkdown } from '#shared/knowledge'

defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Re-run ingestion for a document',
    description: 'Re-parses the stored file and updates matching FAQs in place (by importKey). Detached FAQs are left alone; FAQs no longer in the source become outdated. Then re-indexes in the background.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ stats }' }, 402: { description: 'The FAQs it would create pass the plan\'s FAQ limit; nothing is written.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agentId } = ctx
  const doc = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const key = String(doc.get('storageKey') || '')
  if (!key) throw createError({ statusCode: 400, statusMessage: 'No file stored for this document' })

  const text = (await getDocumentBuffer(key)).toString('utf-8')
  const parsed = parseFaqMarkdown(text)
  const entries = parsed.faqs.map(f => ({ path: f.path, question: f.question, answer: f.answer }))
  const stats = await commitImport(doc, entries, agentId, ctx.workspace)
  await setDocumentStatus(doc, 'processing', { stats })
  await queueKnowledgeIndex(pointerId(doc.get('knowledgeModel')), { documentId: doc.id || '' })
  return { stats }
})
