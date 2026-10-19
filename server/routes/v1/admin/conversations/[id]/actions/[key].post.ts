import { createHmac } from 'node:crypto'
import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Run a configured host action', operationId: 'runConversationAction', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Runs an action declared on the type. HelpBites records an internal timeline event then POSTs the canonical JSON body to the project webhook with `X-HelpBites-Signature: sha256=<hex HMAC-SHA256(body)>`. The payload includes `projectId`, `conversationId`, `type`, `actionKey`, `subjectRef`, `fields`, and `idempotencyKey` (`action:<eventId>`). Hosts must verify the signature and treat that key as at-least-once.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string', example: 'delete' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string', example: 'Removed after copyright confirmation.' } } } } } }, responses: { 200: { description: 'Successful host action.', content: { 'application/json': { schema: { type: 'object', properties: { conversation: { '$ref': '#/components/schemas/Conversation' }, event: { '$ref': '#/components/schemas/Message' }, result: { type: 'string', example: 'success' } } } } } }, 400: { description: 'Action requires a note.' }, 404: { description: 'Unknown conversation or action.' }, 409: { description: 'Project has no webhook configured.' }, 502: { description: 'Host webhook was unavailable or rejected the action.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { agent } = ctx
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(conversation.get('project')))
  const type = await getConversationType(project, conversation.get('type'))
  const actionKey = clampText(getRouterParam(event, 'key'), 40)
  const action = type.actions.find(item => item.key === actionKey)
  if (!action) throw createError({ statusCode: 404, statusMessage: 'Action not found for this conversation type' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const note = clampText(body.note, 8000)
  if (action.requiresNote && !note) throw createError({ statusCode: 400, statusMessage: 'This action requires an internal note' })
  const url = String(project.get('actionWebhookUrl') || '')
  const secret = String(project.get('actionWebhookSecret') || '')
  if (!url || !secret) throw createError({ statusCode: 409, statusMessage: 'This project has no action webhook configured' })
  if (note) await appendInternalNote(conversation, agentDisplayName(project, agent), agent, note)

  const actionEvent = await appendEvent(conversation, { type: 'action.performed', actionKey, result: 'pending', byName: agent.get('name') || agent.get('username') || 'Agent' }, agent)
  const payload = JSON.stringify({ projectId: project.id || '', conversationId: conversation.id || '', type: type.key, actionKey, subjectRef: conversation.get('subjectRef') || conversation.get('context') || null, fields: conversation.get('fields') || {}, idempotencyKey: `action:${actionEvent.id}` })
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  let response: Response
  try {
    // Through the outbound guard like every other webhook: its reply is stored
    // and returned, so a redirect to an internal address would read it back.
    response = await safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-helpbites-signature': `sha256=${signature}` }, body: payload, timeoutMs: 15_000 })
  } catch {
    actionEvent.set('event', { ...actionEvent.get('event'), result: 'failed', error: 'Webhook unavailable' })
    await actionEvent.save(null, MASTER)
    throw createError({ statusCode: 502, statusMessage: 'Host action webhook is unavailable' })
  }
  const result = (await response.text()).slice(0, 1000)
  actionEvent.set('event', { ...actionEvent.get('event'), result: response.ok ? 'success' : 'failed', status: response.status, response: result })
  await actionEvent.save(null, MASTER)
  if (!response.ok) throw createError({ statusCode: 502, statusMessage: 'Host action webhook rejected the action' })
  if (action.statusAfter) await setStatus(conversation, action.statusAfter)
  return { conversation: serializeConversation(conversation), event: serializeMessage(actionEvent), result: 'success' }
})
