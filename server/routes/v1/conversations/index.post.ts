defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'createConversation', security: [{ EndUserToken: [] }],
    summary: 'Start a conversation',
    description: 'Creates a conversation and its first public message. `type` defaults to `support`; configured fields are validated and private/agent-only fields are rejected. Retrying the same `clientId` returns the existing message.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: {
      subject: { type: 'string', maxLength: 200, example: 'Need help with an icon' },
      body: { type: 'string', maxLength: 8000, example: 'The download button does not work.' },
      context: { type: 'object', description: '{ type, id, label, url?, thumbnailUrl? } — compatibility context' },
      type: { type: 'string', description: 'Conversation type; defaults to support', example: 'report' }, fields: { type: 'object', example: { reason: 'copyright' } }, subjectRef: { '$ref': '#/components/schemas/SubjectRef' },
      assistantId: { type: 'string', description: 'Which assistant handles this conversation — its id or slug. The developer chooses this per surface; omit to use the project default.', example: 'asst_help' },
      attachments: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } } },
      clientId: { type: 'string', example: 'web_01JABC' }
    }, example: { type: 'support', subject: 'Need help with an icon', body: 'The download button does not work.', clientId: 'web_01JABC' } } } } },
    responses: { 200: { description: 'Conversation and landed first message.', content: { 'application/json': { schema: { type: 'object', properties: { conversation: { '$ref': '#/components/schemas/Conversation' }, message: { '$ref': '#/components/schemas/Message' }, created: { type: 'boolean' }, agentNotified: { type: 'boolean' } } } } } }, 400: { description: 'Missing body or invalid configured field.' }, 401: { description: 'Invalid identity token.' }, 402: { description: 'The workspace has had this month\'s new conversations. Replies in existing conversations still work.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, endUser, claims } = await requireEndUser(event, { ensure: true, write: 'chat' })
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const input = readMessageInput(payload, project.id || '')
  await rateLimit(`sb:rl:msg:${endUser!.id}`, LIMITS.messagesPerUser.limit, LIMITS.messagesPerUser.window)

  const conversation = await createConversation(project, endUser!, readSubject(payload), input.context, payload)
  await appendEvent(conversation, { type: 'created', byName: endUserDisplayName(endUser!, claims) })
  const { message, created } = await appendMessage({ conversation, sender: 'user', senderName: endUserDisplayName(endUser!, claims), input })

  const email = created ? await notifyAgentsOfUserMessage({ project, conversation, endUser: endUser!, message }) : { sent: false, error: '' }
  if (created) maybeAutoRespond(conversation, message)
  return { conversation: await serializeConversationForEndUser(conversation), message: serializeMessage(message), created, agentNotified: email.sent }
})
