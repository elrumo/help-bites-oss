defineRouteMeta({ openAPI: { tags: ['Knowledge'], summary: 'Delete an FAQ', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '{ deleted }' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const faq = await scoped.faq(ctx, getRouterParam(event, 'id') || '')
  const id = faq.id || ''
  await faq.destroy(MASTER)
  if (meiliConfigured()) await deleteDocuments(KNOWLEDGE_INDEX, [id]).catch(() => {})
  return { deleted: true }
})
