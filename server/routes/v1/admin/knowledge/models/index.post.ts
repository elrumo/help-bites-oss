import { DEFAULT_LANGUAGE } from '#shared/knowledge'

defineRouteMeta({
  openAPI: {
    tags: ['Knowledge'],
    summary: 'Create a knowledge model',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name', 'projectId'], properties: {
      projectId: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, icon: { type: 'string' }, defaultLanguage: { type: 'string' }
    } } } } },
    responses: { 200: { description: '{ model }' }, 402: { description: 'The plan\'s knowledge model limit is reached.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agentId } = ctx
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (typeof payload.name !== 'string' || !payload.name.trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  const projectId = String(payload.projectId || '')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId is required' })
  const project = await requireProject(ctx, projectId) // 404 unless it is one of the caller's
  await checkGauge(ctx.workspace, 'knowledgeModels')

  const Parse = useParse()
  const model = new (Parse.Object.extend('KnowledgeModel'))()
  model.set('workspace', ctx.workspace)
  model.set('project', project)
  model.set('status', 'active')
  model.set('defaultLanguage', DEFAULT_LANGUAGE)
  if (agentId) model.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
  applyKnowledgeModelInput(model, payload)
  await model.save(null, MASTER)
  return { model: serializeKnowledgeModel(model) }
})
