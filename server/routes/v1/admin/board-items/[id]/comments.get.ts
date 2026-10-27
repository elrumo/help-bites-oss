import type { BoardItemComment } from '#shared/board'
import { scoped } from '../../../../../utils/scoped'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'listBoardItemComments', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a planning item’s comments',
    description: 'Returns comments and replies in chronological order. Replies carry parentId and replyToId so clients can render threads. Workspace and project access checks match the item.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }
    ],
    responses: { 200: { description: 'Comments, oldest first.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const query = getQuery(event)
  const { project, row } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(query.project || '') || undefined)
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(query.limit) || 50)))
  const offset = Math.max(0, Math.min(100_000, Math.trunc(Number(query.offset) || 0)))
  const rows = await new (useParse()).Query('BoardItemComment')
    .equalTo('project', project)
    .equalTo('item', row)
    .ascending('createdAt')
    .ascending('objectId')
    .skip(offset)
    .limit(limit + 1)
    .find(MASTER)
  const hasMore = rows.length > limit
  const comments: BoardItemComment[] = rows.slice(0, limit).map(comment => ({
    id: comment.id || '',
    itemId: row.id || '',
    body: String(comment.get('body') || ''),
    parentId: String(comment.get('parentId') || '') || null,
    replyToId: String(comment.get('replyToId') || '') || null,
    actorId: String(comment.get('actorId') || ''),
    actorName: String(comment.get('actorName') || 'Unknown'),
    authorName: String(comment.get('authorName') || comment.get('actorName') || 'Unknown'),
    authorType: comment.get('authorType') === 'assistant' ? 'assistant' : 'operator',
    source: ['web', 'app', 'api', 'mcp'].includes(String(comment.get('source'))) ? comment.get('source') as BoardItemComment['source'] : 'api',
    createdAt: iso(comment.createdAt) || ''
  }))
  return { comments, hasMore, nextOffset: hasMore ? offset + limit : null }
})
