import { scoped } from '../../../../../utils/scoped'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'listBoardItemHistory', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a board item’s edit history',
    description: 'Returns field changes, the operator, and whether each edit came from the web panel, native app, API or MCP. Workspace and project access checks match the item itself.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }
    ],
    responses: { 200: { description: 'History entries, newest first.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const query = getQuery(event)
  const { project, row } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(query.project || '') || undefined)
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(query.limit) || 50)))
  const offset = Math.max(0, Math.min(100_000, Math.trunc(Number(query.offset) || 0)))
  const rows = await new (useParse()).Query('BoardItemHistory')
    .equalTo('project', project)
    .equalTo('itemId', row.id || '')
    .descending('createdAt')
    .descending('objectId')
    .skip(offset)
    .limit(limit + 1)
    .find(MASTER)
  const hasMore = rows.length > limit
  return {
    history: rows.slice(0, limit).map(history => ({
      id: history.id || '',
      itemId: String(history.get('itemId') || ''),
      itemNumber: typeof history.get('itemNumber') === 'number' ? history.get('itemNumber') : null,
      itemTitle: String(history.get('itemTitle') || ''),
      actorId: String(history.get('actorId') || ''),
      actorName: String(history.get('actorName') || 'Unknown'),
      source: String(history.get('source') || 'api'),
      action: String(history.get('action') || 'updated'),
      changes: Array.isArray(history.get('changes')) ? history.get('changes') : [],
      createdAt: iso(history.createdAt) || ''
    })),
    hasMore,
    nextOffset: hasMore ? offset + limit : null
  }
})
