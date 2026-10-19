defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Upload a new version of a document',
    description: 'Stores a new version in the same lineage and returns an import preview to review before committing. Multipart field "file".',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ preview }' }, 402: { description: 'The workspace\'s storage is full.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agentId } = ctx
  const current = await scoped.knowledgeDocument(ctx, getRouterParam(event, 'id') || '')
  const modelId = pointerId(current.get('knowledgeModel'))
  const nodeId = pointerId(current.get('node'))

  const file = await readUploadedFile(event)
  const stored = await storeDocument(file, modelId)

  current.set('isCurrent', false)
  current.set('status', 'archived')
  await current.save(null, MASTER)

  const doc = await createDocumentRecord({
    modelId,
    nodeId: nodeId || undefined,
    file,
    stored,
    lineageId: String(current.get('lineageId') || ''),
    version: Number(current.get('version') || 1) + 1,
    agentId
  })

  const preview = await buildImportPreview(file.data.toString('utf-8'), { modelId, documentId: doc.id || '', lineageId: String(doc.get('lineageId') || ''), version: Number(doc.get('version') || 1) })
  return { preview }
})
