defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'updateBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a board item',
    description: 'Updates only the fields sent (see createBoardItem); `null` clears `targetDate`, `priority` and the descriptions. Moving a card sends `status` and a `rank` between its new neighbours. The first move into a done status stamps `completedAt`. With the board’s `syncFeedback` on, a change of status category moves every linked feedback post to the first feedback status of that category, emailing followers as an admin edit would.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Item id, or its number with `?project=`' }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { status: 'in-progress', rank: 1759312345678.5 } } } } },
    responses: { 200: { description: 'The updated item.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' } } } } } }, 400: { description: 'Invalid value.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  await updateBoardItem(project, ctx.agent, row, await readBody(event).catch(() => ({})))
  return { item: await serializeBoardItem(project, row) }
})
