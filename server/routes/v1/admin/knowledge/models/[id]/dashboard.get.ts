defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Knowledge model dashboard', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ dashboard }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const model = await scoped.knowledgeModel(ctx, getRouterParam(event, 'id') || '')
  return { dashboard: await modelDashboard(model.id || '') }
})
