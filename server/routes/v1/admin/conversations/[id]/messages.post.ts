defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Reply as the team',
    description: 'Signed with the project\'s from-name (or your agent name). Emails the end user unless `notifyByEmail` is false or they have no email.',
    operationId: 'appendAgentMessage',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: {
      body: { type: 'string', example: 'Thanks — we are reviewing this now.' }, replyToId: { type: 'string', example: 'msg_123' }, attachments: { type: 'array', items: { '$ref': '#/components/schemas/Attachment' } }, clientId: { type: 'string', example: 'reply_123' }, notifyByEmail: { type: 'boolean', default: true }
    }, example: { body: 'Thanks — we are reviewing this now.', clientId: 'reply_123', notifyByEmail: true } } } } },
    responses: { 200: { description: 'The durable reply. Repeating `clientId` returns the existing message and `created: false`.', content: { 'application/json': { schema: { type: 'object', required: ['message', 'conversation', 'created', 'emailSent', 'emailError'], properties: { message: { '$ref': '#/components/schemas/Message' }, conversation: { '$ref': '#/components/schemas/Conversation' }, created: { type: 'boolean', example: true }, emailSent: { type: 'boolean', example: true }, emailError: { type: 'string', example: '' } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { agent } = ctx
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(conversation.get('project')))
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const input = readMessageInput(payload, project.id || '')

  const { message, created } = await appendMessage({ conversation, sender: 'agent', senderName: agentDisplayName(project, agent), agent, input })
  const endUser = await (conversation.get('endUser') as ParseObject).fetch(MASTER)
  const email = !created || payload.notifyByEmail === false
    ? { sent: false, error: '' }
    : await notifyUserOfAgentMessage({ project, conversation, endUser, message })

  return { message: serializeMessage(message), conversation: serializeConversation(conversation), created, emailSent: email.sent, emailError: email.error }
})
