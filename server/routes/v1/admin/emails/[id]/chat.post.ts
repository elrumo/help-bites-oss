import { randomUUID } from 'node:crypto'
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, smoothStream, stepCountIs, streamText, type UIMessage } from 'ai'
import { EMAIL_AI_MAX_OUTPUT_TOKENS, emailAiTier } from '#shared/email/ai'
import { normalizeDocument } from '#shared/email/ops'
import type { EmailDocument } from '#shared/email/blocks'
import { conversionSource } from '#shared/email/convert'

defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Talk to the AI designer (stream)', operationId: 'chatEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'AI SDK UI message stream. Body: `{ messages, document, variables, selectedId?, tier: "high" | "ultra", actorId?, chatId? }`. Edits arrive as transient `data-document` / `data-variables` parts while the model works, `data-draft` documents while it is still writing a call that builds many blocks (show them, do not save them), and `data-component` when it saves a component to the library; the final design is saved and broadcast when it finishes. With `chatId` the turn belongs to that chat and keeps running if the client disconnects (re-attach with GET …/chat/stream); without it the turn joins the most recent chat and stops with the connection.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'An AI SDK UI message stream.' }, 409: { description: 'Another turn is still running on this template.' }, 501: { description: 'No LLM endpoint configured.' } } } })

export default defineEventHandler(async (event) => {
  // `member`: `ctx` below is the designer's context.
  const member = await requireMember(event, { can: 'content' })
  const { agent, agentId } = member
  await rateLimit(`sb:rl:emailai:${agentId}`, LIMITS.emailAiPerAgent.limit, LIMITS.emailAiPerAgent.window)
  const row = await scoped.emailTemplate(member, getRouterParam(event, 'id') || '')
  if (row.get('master')) throw createError({ statusCode: 400, statusMessage: 'A linked master is designed in the master itself' })

  const body = (await readBody(event).catch(() => ({}))) as { messages?: UIMessage[], document?: EmailDocument, variables?: unknown, selectedId?: string, tier?: string, actorId?: string, chatId?: string }
  const tier = emailAiTier(body.tier)
  const { model, route } = await emailAiModel(member.workspace, tier)
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
  const last = messages.at(-1)
  if (last?.role !== 'user') throw createError({ statusCode: 400, statusMessage: 'The last message must be the user\'s' })

  const start = body.document ? validateDocument(body.document) : (row.get('document') as EmailDocument)
  const project = row.get('project') ? await requireProject(member, pointerId(row.get('project'))) : null
  const state: EmailAiState = {
    doc: normalizeDocument(start),
    variables: reconcileVariables(start, body.variables ?? row.get('variables')),
    changed: false,
    components: await listEmailComponents(member.workspace, project?.id ?? null),
    saved: 0
  }
  const ctx: EmailAiContext = {
    scope: project ? 'project' : 'master',
    brand: project ? brandOf(project) : null,
    selectedId: body.selectedId,
    source: conversionSource(state.doc, (last.parts || []).map(p => (p.type === 'text' ? p.text : '')).join('\n'), body.selectedId),
    // A project's template saves for that project unless asked to share; a master's are shared.
    saveComponent: async ({ id, shared, ...input }) => {
      // The id comes from the model: one outside this workspace is a 404.
      const component = id ? await scoped.emailComponent(member, id) : new (useParse().Object.extend('EmailComponent'))()
      await applyEmailComponentInput(member, component, { ...input, ...(id ? (shared ? { project: null } : {}) : { project: project && !shared ? project.id : null }) })
      await component.save(null, MASTER)
      return serializeEmailComponent(component)
    }
  }
  // Earlier turns keep only their words: the current design is in the system
  // prompt, so old tool calls (whole documents) would only burn tokens.
  const history = messages
    .map((m, i) => (i === messages.length - 1 ? m : { ...m, parts: (m.parts || []).filter(p => p.type === 'text') }))
    .filter(m => m.parts?.length)
  // The web editor names its chat, and its turns outlive the page (see
  // emailAiRuns). Other clients (the native app) talk in the latest chat and
  // stop when they hang up.
  const resumable = body.chatId != null
  const chatId = resumable ? emailChatId(body.chatId) : (await latestEmailChatId(row)) ?? randomUUID()
  await saveEmailChatMessage(row, chatId, last, { tier, agent })
  const replyId = randomUUID()
  const run = resumable ? await startEmailAiRun(row.id!, chatId, last.id, replyId) : null
  if (resumable && !run) throw createError({ statusCode: 409, statusMessage: 'The designer is still working on this email. Stop that turn or wait for it to finish.' })

  const stream = createUIMessageStream({
    generateId: () => replyId,
    execute: async ({ writer }) => {
      // Bun.serve drops a response idle for 10 s, and the model can think longer
      // than that without streaming a byte (reasoning isn't forwarded), which the
      // browser reports as a network error. The client ignores these pings.
      const ping = setInterval(() => writer.write({ type: 'data-ping', data: {}, transient: true }), 8_000)
      const result = streamText({
        model,
        system: emailSystemPrompt(state, ctx),
        messages: await convertToModelMessages(history),
        tools: emailAiTools(state, writer, ctx),
        // The preview fills in while a whole email is still being written.
        onChunk: emailAiDrafts(state, writer),
        // The reply types out word by word instead of in the model's bursts.
        experimental_transform: smoothStream(),
        stopWhen: stepCountIs(16),
        maxOutputTokens: EMAIL_AI_MAX_OUTPUT_TOKENS,
        maxRetries: 2,
        abortSignal: run?.signal,
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
      console.error('[emails] AI designer failed:', error instanceof Error ? error.message : error)
      return 'The AI designer could not reach the model. Anything it already changed is in the editor; undo reverts the whole turn.'
    },
    onFinish: async ({ responseMessage }) => {
      // Persisting must never break the stream: the editor already holds the
      // document and its autosave covers a failure here.
      try {
        if (responseMessage?.parts?.length) await saveEmailChatMessage(row, chatId, responseMessage, { tier })
        if (state.changed) {
          row.set('document', validateDocument(state.doc))
          row.set('variables', reconcileVariables(state.doc, state.variables))
          // A turn that outlived its page has no tab holding the result, so
          // every tab takes this save, the one that asked included.
          row.set('lastActorId', run ? 'ai' : String(body.actorId || '').slice(0, 64))
          await saveAndBroadcast(row)
        }
      } catch (error) {
        console.error('[emails] saving the AI turn failed:', (error as Error).message)
      }
    }
  })
  return createUIMessageStreamResponse({ stream, consumeSseStream: run ? ({ stream }) => run.record(stream) : undefined })
})
