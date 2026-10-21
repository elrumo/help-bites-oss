import { clampText } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['Error tracking'], operationId: 'getFiledError', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The board item an error was filed as',
    description: 'The item `fileErrorOnBoard` made for this issue, or `null` when it has not been filed. `boardEnabled` says whether the project board is on (filing needs it).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The tracker\'s issue id' }, { name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'link', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'The item, or null.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' }, boardEnabled: { type: 'boolean' } } } } } }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project or tracker link not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const project = await requireProject(ctx, clampText(query.project, 40))
  const link = errorLinkOf(project, clampText(query.link, 40))
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Error tracking is not connected' })
  const item = await findFiledError(project, link, getRouterParam(event, 'id') || '')
  return { item: item ? await serializeBoardItem(project, item) : null, boardEnabled: getBoardConfig(project).enabled }
})
