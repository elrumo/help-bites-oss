import { clampText } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['Error tracking'], operationId: 'fileErrorOnBoard', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'File an error on the project board',
    description: 'Creates a board item from a tracker issue: titled from the issue, with its culprit, how often it happened and a link to the tracker in the (internal) description, and an `errorRefs` entry carrying the same link. Idempotent per issue: filing it again returns the existing item with `created: false`. When the error already has a conversation in the inbox it is linked to the item. Needs the project board switched on. Emits `errors.filed_on_board`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The tracker\'s issue id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, link: { type: 'string', description: 'Tracker project (link) id; defaults to the first' } } } } } },
    responses: { 200: { description: 'The item.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' }, created: { type: 'boolean' } } } } } }, 400: { description: 'The board is off.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project, tracker link or issue not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) as { project?: string, link?: string }
  const project = await requireProject(ctx, clampText(body.project, 40))
  const link = errorLinkOf(project, clampText(body.link, 40))
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Error tracking is not connected' })
  const { item, created } = await fileErrorOnBoard(project, ctx.agent, link, getRouterParam(event, 'id') || '')
  return { item: await serializeBoardItem(project, item), created }
})
