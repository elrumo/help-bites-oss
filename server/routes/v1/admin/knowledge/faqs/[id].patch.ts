defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Update an FAQ',
    description: 'Editing an imported FAQ marks it detached, so a later re-import will not overwrite the edit.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ faq }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const faq = await scoped.faq(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  applyFaqInput(faq, body, { isEdit: true })
  if ('nodeId' in body) {
    // A foreign node is a 404; setFaqNode then checks it is in the FAQ's model.
    if (body.nodeId) await scoped.knowledgeNode(ctx, String(body.nodeId))
    await setFaqNode(faq, String(body.nodeId || ''))
  }
  await faq.save(null, MASTER)
  await queueKnowledgeIndex(pointerId(faq.get('knowledgeModel')))
  return { faq: serializeFaq(await scoped.faq(ctx, faq.id || '')) }
})
