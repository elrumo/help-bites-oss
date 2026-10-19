defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'linkBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Link or unlink a post or conversation',
    description: 'Links (`linked: true`, the default) or unlinks one feedback post (`kind: "feedback"`, by id or `#N`) or support conversation (`kind: "conversation"`). Both must belong to the item’s project. An item links at most 50 of each. Linking a conversation adds an internal `board.linked` event to its timeline; unlinking adds `board.unlinked`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['kind', 'id'], properties: { kind: { type: 'string', enum: ['feedback', 'conversation'] }, id: { type: 'string', example: '#12' }, linked: { type: 'boolean', default: true } } } } } },
    responses: { 200: { description: 'The item with its links.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' } } } } } }, 400: { description: 'Bad kind, or the item already has 50 links of that kind.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item, post or conversation not found in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  const { kind, id, linked } = readLinkInput(await readBody(event).catch(() => ({})))
  const fresh = await linkBoardItem(project, ctx.agent, row, kind, id, linked)
  return { item: await serializeBoardItem(project, fresh) }
})
