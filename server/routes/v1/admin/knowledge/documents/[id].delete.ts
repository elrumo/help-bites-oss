defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Delete a document',
    description: 'Without ?confirm=true, returns the impact. On confirm the file is removed and FAQs imported from it keep their content but lose the source link (they are not deleted).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'confirm', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '{ deleted, impact? }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const Parse = useParse()
  const doc = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const faqCount = await countFaqsForDocument(doc.id || '')
  if (String(getQuery(event).confirm) !== 'true') {
    return { deleted: false, impact: { faqs: faqCount, note: 'These FAQs will keep their content but lose the source link.' } }
  }
  await eachBatch(() => new Parse.Query('Faq').equalTo('sourceDocument', doc), async (faqs) => {
    for (const f of faqs) f.unset('sourceDocument')
    await Parse.Object.saveAll(faqs, MASTER)
  }, { keys: ['objectId'] })
  await deleteDocumentObject(String(doc.get('storageKey') || ''))
  await doc.destroy(MASTER)
  await chargeUsage(ctx.workspaceId, 'storageBytes', -Number(doc.get('size') || 0))
  return { deleted: true }
})
