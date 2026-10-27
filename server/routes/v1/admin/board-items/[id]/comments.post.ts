import { createError } from 'h3'
import { FEEDBACK_COMMENT_MAX_LENGTH } from '#shared/feedback'
import { readItemAttachments } from '#shared/itemAttachments'
import { clientSource } from '../../../../../utils/clientSource'
import { assertOwnAttachments } from '../../../../../utils/itemAttachments'
import { pointerId } from '../../../../../utils/parse'
import { scoped } from '../../../../../utils/scoped'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'commentOnBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Comment on a planning item',
    description: 'Adds an internal comment or reply, with up to 10 project uploads. MCP comments show the connected assistant name while retaining the operator who authorized it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string', description: `Up to ${FEEDBACK_COMMENT_MAX_LENGTH} characters.` }, attachments: { type: 'array', items: { type: 'object' }, description: 'Up to 10 files returned by POST /v1/feedback/attachments.' }, parentId: { type: 'string', description: 'The root comment id when replying.' }, replyToId: { type: 'string', description: 'The comment being replied to; also determines parentId.' } } } } } },
    responses: { 201: { description: 'The comment.' }, 400: { description: 'Empty or too-long comment, or invalid thread target.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Item or comment not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row: item } = await scoped.boardItem(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  const input = (await readBody(event).catch(() => ({})) || {}) as Record<string, unknown>
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (body.length > FEEDBACK_COMMENT_MAX_LENGTH) throw createError({ statusCode: 400, statusMessage: `Comment is longer than ${FEEDBACK_COMMENT_MAX_LENGTH} characters` })
  const attachmentErrors: string[] = []
  const attachments = input.attachments === undefined ? [] : readItemAttachments(input.attachments, attachmentErrors) || []
  if (attachmentErrors.length) throw createError({ statusCode: 400, statusMessage: attachmentErrors.join('; ') })
  assertOwnAttachments(project, attachments)
  if (!body && !attachments.length) throw createError({ statusCode: 400, statusMessage: 'Comment text or an attachment is required' })

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
  comment.set('attachments', attachments)
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
      id: comment.id || '', itemId: item.id || '', body, attachments,
      parentId: rootId || null, replyToId: repliedToId || null,
      actorId: ctx.agentId, actorName, authorName,
      authorType: source === 'mcp' ? 'assistant' : 'operator', source,
      createdAt: iso(comment.createdAt) || new Date().toISOString()
    }
  }
})
