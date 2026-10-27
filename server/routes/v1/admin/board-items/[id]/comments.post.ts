import { createError } from 'h3'
import { FEEDBACK_COMMENT_MAX_LENGTH } from '#shared/feedback'
import { clientSource } from '../../../../../utils/clientSource'
import { pointerId } from '../../../../../utils/parse'
import { scoped } from '../../../../../utils/scoped'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'commentOnBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Comment on a planning item',
    description: 'Adds an internal comment or reply. MCP comments show the connected assistant name while retaining the operator who authorized it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', maxLength: FEEDBACK_COMMENT_MAX_LENGTH }, parentId: { type: 'string', description: 'The root comment id when replying.' }, replyToId: { type: 'string', description: 'The comment being replied to; also determines parentId.' } } } } } },
    responses: { 201: { description: 'The comment.' }, 400: { description: 'Empty or too-long comment, or invalid thread target.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item or comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row: item } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  const input = await readBody<Record<string, unknown>>(event).catch(() => ({})) || {}
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body) throw createError({ statusCode: 400, statusMessage: 'Comment cannot be empty' })
  if (body.length > FEEDBACK_COMMENT_MAX_LENGTH) throw createError({ statusCode: 400, statusMessage: `Comment is longer than ${FEEDBACK_COMMENT_MAX_LENGTH} characters` })

  const parentId = typeof input.parentId === 'string' ? input.parentId.trim() : ''
  const replyToId = typeof input.replyToId === 'string' ? input.replyToId.trim() : ''
  const targetId = replyToId || parentId
  let rootId = ''
  let repliedToId = ''
  if (targetId) {
    const target = await new (useParse()).Query('BoardItemComment').get(targetId, MASTER).catch(() => null)
    if (!target || pointerId(target.get('project')) !== project.id || pointerId(target.get('item')) !== item.id) {
      throw createError({ statusCode: 404, statusMessage: 'Comment not found on this item' })
    }
    rootId = String(target.get('parentId') || target.id || '')
    if (parentId && parentId !== rootId && parentId !== target.id) throw createError({ statusCode: 400, statusMessage: 'Reply target is outside this thread' })
    repliedToId = target.id || ''
  }

  const source = clientSource(event)
  const actorName = String(ctx.agent.get('name') || ctx.agent.get('username') || 'Unknown').trim().slice(0, 120)
  let authorName = actorName
  if (source === 'mcp') {
    const key = ctx.apiKeyId ? await new (useParse()).Query('AdminApiKey').get(ctx.apiKeyId, MASTER).catch(() => null) : null
    authorName = String(key?.get('name') || '').replace(/^MCP:\s*/i, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'MCP'
  }

  const comment = new (useParse()).Object('BoardItemComment')
  comment.set('project', project)
  comment.set('item', item)
  comment.set('body', body)
  comment.set('actorId', ctx.agentId)
  comment.set('actorName', actorName)
  comment.set('authorName', authorName)
  comment.set('authorType', source === 'mcp' ? 'assistant' : 'operator')
  comment.set('source', source)
  if (rootId) {
    comment.set('parentId', rootId)
    comment.set('replyToId', repliedToId)
  }
  await comment.save(null, MASTER)
  setResponseStatus(event, 201)
  return {
    comment: {
      id: comment.id || '', itemId: item.id || '', body,
      parentId: rootId || null, replyToId: repliedToId || null,
      actorId: ctx.agentId, actorName, authorName,
      authorType: source === 'mcp' ? 'assistant' : 'operator', source,
      createdAt: iso(comment.createdAt) || new Date().toISOString()
    }
  }
})
