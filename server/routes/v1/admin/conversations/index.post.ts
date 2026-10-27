import { clampText } from '#shared/support'
import { startConversationClaims } from '../../../../utils/startConversation'
defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Start a conversation with an end user',
    description: 'Works for users who never opened the widget: pass the host app\'s user id (`externalId`) and optionally their name/email, and the EndUser row is created. A user already on record keeps the name and email it has: these only fill what is empty.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['projectId', 'externalId', 'body'], properties: {
      projectId: { type: 'string' }, externalId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
      subject: { type: 'string' }, body: { type: 'string' }, type: { type: 'string' }, fields: { type: 'object' }, subjectRef: { type: 'object' }, priority: { type: 'string' }, attachments: { type: 'array', items: { type: 'object' } }, notifyByEmail: { type: 'boolean', default: true }
    } } } } },
    responses: { 200: { description: '{ conversation, message, endUser, emailSent, emailError }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { agent } = ctx
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const externalId = clampText(payload.externalId, 200)
  if (!externalId) throw createError({ statusCode: 400, statusMessage: 'externalId is required' })

  const project = await requireProject(ctx, String(payload.projectId || ''))
  // The end user is found or created by externalId inside this project only. A customer already on record keeps their name and address.
  const endUser = await ensureEndUser(project, startConversationClaims(await findEndUser(project, externalId), payload, externalId))
  const input = readMessageInput(payload, project.id || '')

  const conversation = await createConversation(project, endUser, readSubject(payload), input.context, payload, 'agent')
  await appendEvent(conversation, { type: 'created', byName: agentDisplayName(project, agent) }, agent)
  const { message } = await appendMessage({ conversation, sender: 'agent', senderName: agentDisplayName(project, agent), agent, input })

  const email = payload.notifyByEmail === false
    ? { sent: false, error: '' }
    : await notifyUserOfAgentMessage({ project, conversation, endUser, message })

  return { conversation: serializeConversation(conversation), message: serializeMessage(message), endUser: serializeEndUser(endUser), emailSent: email.sent, emailError: email.error }
})
