import { UI_MESSAGE_STREAM_HEADERS } from 'ai'

defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'Re-attach to a running assistant turn', operationId: 'resumeCmsChat', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Replays the turn\'s stream from its first chunk, then follows it live. `id` is the `streamId` from GET /v1/admin/cms/chat.', parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'entry', in: 'query', schema: { type: 'string' } }, { name: 'component', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'An AI SDK UI message stream.' }, 204: { description: 'The turn is over: read the chat instead.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const scope = await cmsAiScope(ctx, event)
  const replay = await replayEmailAiRun(cmsRunKey(scope), emailChatId(getQuery(event).id))
  return replay ? new Response(replay, { headers: UI_MESSAGE_STREAM_HEADERS }) : new Response(null, { status: 204 })
})
