defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Upload a document and get an import preview',
    description: 'Multipart field "file" (.md/.txt). Query: modelId (required), nodeId (optional destination path). Stores the file and returns detected paths/FAQs to review — nothing is imported until commit.',
    parameters: [{ name: 'modelId', in: 'query', required: true, schema: { type: 'string' } }, { name: 'nodeId', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '{ preview }' }, 402: { description: 'The workspace\'s storage is full.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agentId } = ctx
  const q = getQuery(event)
  const modelId = String(q.modelId || '')
  if (!modelId) throw createError({ statusCode: 400, statusMessage: 'modelId is required' })
  await scoped.knowledgeModel(ctx, modelId)

  let pathPrefix: string[] = []
  const nodeId = String(q.nodeId || '')
  if (nodeId) {
    const node = await scoped.knowledgeNode(ctx, nodeId)
    if (pointerId(node.get('knowledgeModel')) !== modelId) throw createError({ statusCode: 400, statusMessage: 'Node belongs to another model' })
    pathPrefix = String(node.get('pathCache') || '').split('/').filter(Boolean)
  }

  const file = await readUploadedFile(event)
  const stored = await storeDocument(file, modelId)
  const doc = await createDocumentRecord({ modelId, nodeId: nodeId || undefined, file, stored, agentId })
  const preview = await buildImportPreview(file.data.toString('utf-8'), { modelId, documentId: doc.id || '', lineageId: String(doc.get('lineageId') || ''), version: 1, pathPrefix })
  return { preview }
})
