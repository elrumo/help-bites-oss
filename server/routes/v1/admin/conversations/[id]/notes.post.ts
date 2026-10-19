import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Add an internal note', operationId: 'createInternalNote', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Creates an immutable `Message` with `visibility: internal`. It is returned to agents and never exposed through end-user message APIs or SSE.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', maxLength: 8000, example: 'Confirmed owner has been contacted.' } }, example: { body: 'Confirmed owner has been contacted.' } } } } }, responses: { 200: { description: 'Internal message.', content: { 'application/json': { schema: { type: 'object', properties: { message: { '$ref': '#/components/schemas/Message' } } } } } }, 400: { description: 'Missing note body.' }, 401: { description: 'Admin session or API key required.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { agent } = ctx
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const body = clampText((await readBody(event).catch(() => ({})) as Record<string, unknown>).body, 8000)
  if (!body) throw createError({ statusCode: 400, statusMessage: 'Note body is required' })
  const message = await appendInternalNote(conversation, agentDisplayName(await requireProject(ctx, pointerId(conversation.get('project'))), agent), agent, body)
  return { message: serializeMessage(message) }
})
