defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Download the original document', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'The original file' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const doc = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const key = String(doc.get('storageKey') || '')
  if (!key) throw createError({ statusCode: 404, statusMessage: 'No file stored for this document' })
  const buffer = await getDocumentBuffer(key)
  const name = String(doc.get('originalFilename') || 'document.md').replace(/[^\w.\- ]+/g, '_')
  setHeader(event, 'Content-Type', String(doc.get('mimeType') || 'text/plain') + '; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${name}"`)
  return buffer
})
