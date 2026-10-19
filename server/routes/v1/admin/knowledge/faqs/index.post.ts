import { normalizeQuestion, DEFAULT_LANGUAGE } from '#shared/knowledge'

defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Create an FAQ manually',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['modelId', 'question'], properties: {
      modelId: { type: 'string' }, nodeId: { type: 'string' }, question: { type: 'string' }, answer: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } }, status: { type: 'string' }, language: { type: 'string' }
    } } } } },
    responses: { 200: { description: '{ faq }' }, 402: { description: 'The plan\'s FAQ limit is reached.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agentId } = ctx
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const modelId = String(body.modelId || '')
  if (!modelId) throw createError({ statusCode: 400, statusMessage: 'modelId is required' })
  if (typeof body.question !== 'string' || !body.question.trim()) throw createError({ statusCode: 400, statusMessage: 'question is required' })

  const model = await scoped.knowledgeModel(ctx, modelId)
  await checkGauge(ctx.workspace, 'faqs')
  const Parse = useParse()
  const faq = new (Parse.Object.extend('Faq'))()
  faq.set('knowledgeModel', model)
  faq.set('origin', 'manual')
  faq.set('status', 'active')
  faq.set('language', DEFAULT_LANGUAGE)
  faq.set('normalizedQuestion', normalizeQuestion(String(body.question)))
  faq.set('needsReindex', true)
  if (agentId) faq.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
  applyFaqInput(faq, body)
  if (body.nodeId) {
    // A foreign node is a 404; setFaqNode then checks it is in this model.
    await scoped.knowledgeNode(ctx, String(body.nodeId))
    await setFaqNode(faq, String(body.nodeId))
  }
  await faq.save(null, MASTER)
  await queueKnowledgeIndex(modelId)
  return { faq: serializeFaq(await scoped.faq(ctx, faq.id || '')) }
})
