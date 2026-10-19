import { UI_MESSAGE_STREAM_HEADERS } from 'ai'

defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Re-attach to a running AI designer turn', operationId: 'resumeEmailChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Replays the turn\'s UI message stream from its first chunk, then follows it live until it ends. Take `id` from GET …/chat (`streamId`).', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'id', in: 'query', required: true, schema: { type: 'string' }, description: 'The turn\'s `streamId`.' }], responses: { 200: { description: 'An AI SDK UI message stream.' }, 204: { description: 'The turn is over and no longer replayable: read the chat instead.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const template = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const replay = await replayEmailAiRun(template.id!, emailChatId(getQuery(event).id))
  return replay ? new Response(replay, { headers: UI_MESSAGE_STREAM_HEADERS }) : new Response(null, { status: 204 })
})
