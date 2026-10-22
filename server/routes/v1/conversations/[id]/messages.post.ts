defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'appendConversationMessage', security: [{ EndUserToken: [] }],
    summary: 'Send a message',
    description: 'Appends a public message to one of the caller’s conversations. A user reply reopens a terminal status only when the type permits reopening. Internal notes are never returned here.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: {
      body: { type: 'string', maxLength: 8000, example: 'Here is a screenshot of the error.' },
      replyToId: { type: 'string', description: 'Message in this conversation this one answers' },
      context: { type: 'object' },
      attachments: { type: 'array', items: { type: 'object' } },
      clientId: { type: 'string', description: 'Idempotency key from the client outbox', example: 'web_01JDEF' }
    }, example: { body: 'Here is a screenshot of the error.', clientId: 'web_01JDEF' } } } } },
    responses: { 200: { description: 'Landed message; repeat client IDs return the original.', content: { 'application/json': { schema: { type: 'object', properties: { message: { '$ref': '#/components/schemas/Message' }, conversation: { '$ref': '#/components/schemas/Conversation' }, created: { type: 'boolean' } } } } } }, 404: { description: 'Not owned by this identity token.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, endUser, claims } = await requireEndUser(event, { ensure: true, write: 'chat' })
  const conversation = await getConversation(getRouterParam(event, 'id') || '')
  if (pointerId(conversation.get('endUser')) !== endUser!.id) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const input = readMessageInput(payload, project.id || '')
  await rateLimit(`sb:rl:msg:${endUser!.id}`, LIMITS.messagesPerUser.limit, LIMITS.messagesPerUser.window)

  const { message, created } = await appendMessage({ conversation, sender: 'user', senderName: endUserDisplayName(endUser!, claims), input })
  const email = created ? await notifyAgentsOfUserMessage({ project, conversation, endUser: endUser!, message }) : { sent: false, error: '' }
  if (created) maybeAutoRespond(conversation, message)
  return { message: serializeMessage(message), conversation: await serializeConversationForEndUser(conversation), created, agentNotified: email.sent }
})
