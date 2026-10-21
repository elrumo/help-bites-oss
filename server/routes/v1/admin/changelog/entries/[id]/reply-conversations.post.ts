import { readChangelogReplyInput } from '#shared/changelogReply'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'replyToChangelogConversations', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Tell the people an entry answers',
    description: 'Appends one reply, as the team, to each chosen conversation (every conversation `GET …/linked-conversations` lists when `conversationIds` is left out) and emails the customer unless `notifyByEmail` is false or they have no email. The same reply path as `appendAgentMessage`. One failing does not stop the rest; sending the same text to the same conversation again is a no-op. Up to 100 conversations per call.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry id, or its number with `?project=`' }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', example: 'Good news: “Dark mode” has just shipped.' }, conversationIds: { type: 'array', items: { type: 'string' } }, notifyByEmail: { type: 'boolean', default: true } } } } } },
    responses: { 200: { description: 'What happened to each conversation.', content: { 'application/json': { schema: { type: 'object', required: ['sent', 'failed', 'results'], properties: { sent: { type: 'integer', example: 2 }, failed: { type: 'integer', example: 0 }, results: { type: 'array', items: { type: 'object', properties: { conversationId: { type: 'string' }, ok: { type: 'boolean' }, emailSent: { type: 'boolean' }, error: { type: 'string' } } } } } } } } }, 400: { description: 'No message, or too many conversations.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Entry not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { project, row } = await scoped.changelogEntry(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  const { value, errors } = readChangelogReplyInput(await readBody(event).catch(() => ({})))
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  return await replyToLinkedConversations(project, ctx.agent, row, value)
})
