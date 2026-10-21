import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, smoothStream, stepCountIs, streamText, type UIMessage } from 'ai'
import { randomUUID } from 'node:crypto'
import { EMAIL_AI_MAX_OUTPUT_TOKENS, emailAiTier } from '#shared/email/ai'
import { normalizeContent, normalizeStyle, type CmsBlock } from '#shared/cms/content'

defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'Talk to the Pages assistant (stream)', operationId: 'chatCms', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'AI SDK UI message stream. Body: `{ project, entry?, component?, messages, content?, selectedId?, tier: "high" | "ultra" }`: the chat is about an entry, a component, or (with neither) the project. Edits arrive as transient parts while the model works: `data-content` (the entry\'s new content tree), `data-page` (name, slug, style), `data-component` (a component it saved) and `data-brief`. When the turn ends the entry is saved. The turn keeps running if the client disconnects: re-attach with GET /v1/admin/cms/chat/stream.', responses: { 200: { description: 'An AI SDK UI message stream.' }, 409: { description: 'Another turn is still running in this chat.' }, 501: { description: 'No LLM endpoint configured.' } } } })

export default defineEventHandler(async (event) => {
  const member = await requireMember(event, { can: 'content' })
  await rateLimit(`sb:rl:cmsai:${member.agentId}`, LIMITS.emailAiPerAgent.limit, LIMITS.emailAiPerAgent.window)
  const body = (await readBody(event).catch(() => ({}))) as { messages?: UIMessage[], content?: CmsBlock, selectedId?: string, tier?: string } & Record<string, unknown>
  const scope = await cmsAiScope(member, event, body)
  const tier = emailAiTier(body.tier)
  const { model, route } = await emailAiModel(member.workspace, tier)
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
  const last = messages.at(-1)
  if (last?.role !== 'user') throw createError({ statusCode: 400, statusMessage: 'The last message must be the user\'s' })

  const library = await cmsLibrary(scope.project)
  const rootType = scope.entry ? String(scope.entry.get('type') || 'page') : 'page'
  const state: CmsAiState = {
    library,
    rootType,
    // The editor sends what it shows, unsaved edits included.
    content: scope.entry ? normalizeContent(body.content ?? scope.entry.get('content'), library, rootType).content : null,
    name: String(scope.entry?.get('name') || ''),
    slug: String(scope.entry?.get('slug') || ''),
    style: normalizeStyle(scope.entry?.get('style')),
    changed: false,
    pageChanged: false,
    brief: cmsSettingsOf(scope.project).brief,
    saved: 0
  }
  const ctx: CmsAiContext = {
    project: scope.project,
    selectedId: body.selectedId,
    componentKey: scope.component ? String(scope.component.get('key') || '') : undefined,
    saveComponent: async (input) => {
      const existing = (await listCmsComponents(scope.project)).find(r => r.get('key') === input.key)
      return cmsComponentDef(await saveCmsComponent(scope.project, input, existing))
    },
    saveBrief: async (brief) => {
      await saveCmsSettings(scope.project, { brief })
    }
  }
  // Earlier turns keep only their words: the current page is in the system prompt.
  const history = messages
    .map((m, i) => (i === messages.length - 1 ? m : { ...m, parts: (m.parts || []).filter(p => p.type === 'text') }))
    .filter(m => m.parts?.length)
  await saveCmsChatMessage(scope, last, { tier, agent: member.agent })
  const replyId = randomUUID()
  const key = cmsRunKey(scope)
  const run = await startEmailAiRun(key, 'main', last.id, replyId)
  if (!run) throw createError({ statusCode: 409, statusMessage: 'The assistant is still working here. Stop that turn or wait for it to finish.' })

  const stream = createUIMessageStream({
    generateId: () => replyId,
    execute: async ({ writer }) => {
      // Bun drops a response idle for 10 s; the client ignores these pings.
      const ping = setInterval(() => writer.write({ type: 'data-ping', data: {}, transient: true }), 8_000)
      const result = streamText({
        model,
        system: cmsSystemPrompt(state, ctx),
        messages: await convertToModelMessages(history),
        tools: cmsAiTools(state, writer, ctx),
        experimental_transform: smoothStream(),
        stopWhen: stepCountIs(24),
        maxOutputTokens: EMAIL_AI_MAX_OUTPUT_TOKENS,
        maxRetries: 2,
        abortSignal: run.signal,
        onFinish: ({ steps }) => {
          clearInterval(ping)
          void recordAiSteps(route, steps)
        },
        onError: () => clearInterval(ping),
        onAbort: ({ steps }) => {
          clearInterval(ping)
          void recordAiSteps(route, steps)
        }
      })
      writer.merge(result.toUIMessageStream())
    },
    onError: (error) => {
      console.error('[cms] assistant failed:', error instanceof Error ? error.message : error)
      return 'The assistant could not reach the model. Anything it already changed is in the editor; undo reverts the whole turn.'
    },
    onFinish: async ({ responseMessage }) => {
      // Saving must never break the stream: the editor holds the content and autosaves it too.
      try {
        if (responseMessage?.parts?.length) await saveCmsChatMessage(scope, responseMessage, { tier })
        if (scope.entry && (state.changed || state.pageChanged)) {
          await updateCmsEntry(scope.project, scope.entry, {
            ...(state.changed ? { content: state.content } : {}),
            ...(state.pageChanged ? { name: state.name, style: state.style, ...(state.slug !== scope.entry.get('slug') ? { slug: state.slug } : {}) } : {})
          })
        }
      } catch (error) {
        console.error('[cms] saving the assistant\'s turn failed:', (error as Error).message)
      }
    }
  })
  return createUIMessageStreamResponse({ stream, consumeSseStream: ({ stream }) => run.record(stream) })
})
