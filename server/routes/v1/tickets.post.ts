import { clampText } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['Host server'], summary: 'Open a typed ticket for a host user', operationId: 'createHostTicket', security: [{ ProjectSecret: [] }],
    description: 'Server-to-server intake. It upserts the EndUser by `externalId`, validates `fields` against the configured type, creates a public first message, and returns the existing conversation for a repeated `idempotencyKey`. `subjectRef.url` and every configured `url` field must be http(s).',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['externalId', 'type', 'body', 'idempotencyKey'], properties: {
      externalId: { type: 'string', example: 'user_42' }, name: { type: 'string', example: 'Ada Lovelace' }, email: { type: 'string', format: 'email', example: 'ada@example.com' }, type: { type: 'string', example: 'report' }, subject: { type: 'string', example: 'Report an icon' }, body: { type: 'string', example: 'This icon copies the official artwork.' }, fields: { type: 'object', example: { reason: 'copyright', sourceUrl: 'https://source.example.com' } }, subjectRef: { '$ref': '#/components/schemas/SubjectRef' }, assistantId: { type: 'string', description: 'Which assistant handles this ticket — its id or slug; omit to use the project default.', example: 'asst_reports' }, idempotencyKey: { type: 'string', example: 'report:user_42:icon_123' }
    }, example: { externalId: 'user_42', name: 'Ada Lovelace', email: 'ada@example.com', type: 'report', subject: 'Report an icon', body: 'This icon copies the official artwork.', fields: { reason: 'copyright', sourceUrl: 'https://source.example.com' }, subjectRef: { type: 'icon', id: 'icon_123', label: 'Arc Browser' }, idempotencyKey: 'report:user_42:icon_123' } } } } },
    responses: { 200: { description: 'Created ticket, or the existing ticket when the idempotency key was already used.', content: { 'application/json': { schema: { type: 'object', required: ['conversation', 'created'], properties: { conversation: { '$ref': '#/components/schemas/Conversation' }, message: { anyOf: [{ '$ref': '#/components/schemas/Message' }, { type: 'null' }] }, created: { type: 'boolean' }, agentNotified: { type: 'boolean' } } } } } }, 400: { description: 'Invalid type, intake field, URL, or missing required input.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } }, 401: { description: 'Missing or invalid project secret.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await requireProjectSecret(event)
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const externalId = clampText(payload.externalId, 200)
  const idempotencyKey = clampText(payload.idempotencyKey, 200)
  if (!externalId || !idempotencyKey) throw createError({ statusCode: 400, statusMessage: 'externalId and idempotencyKey are required' })

  const Parse = useParse()
  // ponytail: read-before-create dedupe; make this a unique Mongo index only if concurrent host retries prove it necessary.
  const existing = await new Parse.Query('Conversation').equalTo('project', project).equalTo('idempotencyKey', idempotencyKey).first(MASTER)
  if (existing) {
    const message = await new Parse.Query('Message').equalTo('conversation', existing).ascending('createdAt').first(MASTER)
    return { conversation: serializeConversation(existing), message: message ? serializeMessage(message) : null, created: false }
  }

  const endUser = await ensureEndUser(project, { sub: externalId, name: clampText(payload.name, 120), email: clampText(payload.email, 200) })
  const input = readMessageInput(payload, project.id || '')
  const conversation = await createConversation(project, endUser, readSubject(payload), input.context, payload, 'agent')
  await appendEvent(conversation, { type: 'created', byName: 'Host' })
  const { message } = await appendMessage({ conversation, sender: 'user', senderName: endUserDisplayName(endUser, { sub: externalId, name: clampText(payload.name, 120) }), input })
  const email = await notifyAgentsOfUserMessage({ project, conversation, endUser, message })
  return { conversation: serializeConversation(conversation), message: serializeMessage(message), created: true, agentNotified: email.sent }
})
