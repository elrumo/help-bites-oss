defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'deleteBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a board item',
    description: 'Removes the item and its links. The linked posts and conversations stay.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } } } }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  await deleteBoardItem(row)
  return { deleted: true }
})
