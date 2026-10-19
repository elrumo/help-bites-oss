import { buildNodeTree } from '#shared/knowledge'

defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'List path nodes for a model', parameters: [{ name: 'modelId', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ nodes, tree }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const modelId = String(getQuery(event).modelId || '')
  if (!modelId) throw createError({ statusCode: 400, statusMessage: 'modelId is required' })
  await scoped.knowledgeModel(ctx, modelId)
  const nodes = (await listNodesForModel(modelId)).map(serializeKnowledgeNode)
  return { nodes, tree: buildNodeTree(nodes) }
})
