import { clientSource } from '../../../../../utils/clientSource'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'mergeBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Fold a duplicate item into another',
    description: 'Merges this item (the source) into `into`, an item of the same project and the same kind (card or epic). The target takes the source’s linked feedback posts and conversations, labels, attachments and, for an epic, its cards; the two end up related. The source is unpublished from the roadmap and moved to the board’s first closed status, with its links removed so the board’s feedback sync never closes the posts. **Nothing is deleted**: the source keeps its text, comments and history. The merged text is the caller’s job: edit the target with `PATCH /v1/admin/board-items/{id}`. Refused, with nothing changed, when the target would link more than 50 posts or conversations, or hold more than 10 attachments.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The source item: its id, or `#N` with `project`' }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['into'], properties: { into: { type: 'string', example: '#12', description: 'The item to merge into: its id or `#N`' } } } } } },
    responses: { 200: { description: 'The source and the target, as they are now.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem', description: 'The source' }, into: { '$ref': '#/components/schemas/BoardItem', description: 'The target' } } } } } }, 400: { description: 'Merging into itself, items of different kinds, or the merged item would exceed a limit.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item, or the item to merge into, not found in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  const { item, into } = await mergeBoardItem(project, ctx.agent, row, await readBody(event).catch(() => ({})), clientSource(event))
  return { item: await serializeBoardItem(project, item), into: await serializeBoardItem(project, into) }
})
