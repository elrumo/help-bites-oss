import { readAiChatMessages } from '#shared/aiCards'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'createCardsWithAi', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Turn text into feedback posts or board items with AI',
    description: 'The AI chat on the feedback and board pages. Send the conversation so far; the AI splits the last user message into separate cards and creates them, the same way `POST /v1/feedback?project=` (`kind: "feedback"`, authored by the team) or `POST /v1/admin/board-items` (`kind: "board"`) would. It only uses types, tags and labels the project defines, files at most 20 cards per turn, and treats pasted text as data. Cards that fail to create are listed in `failed`; the rest are kept. Metered like every AI call (workspace provider or credits). 501 when no AI is configured.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['kind', 'messages'], properties: {
      kind: { type: 'string', enum: ['feedback', 'board'] },
      messages: { type: 'array', maxItems: 12, items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string', maxLength: 20000 } } }, example: [{ role: 'user', content: 'Customers keep asking for CSV export, and iOS crashes when I open settings.' }] }
    } } } } },
    responses: { 200: { description: 'What the AI said and the cards it created.', content: { 'application/json': { schema: { type: 'object', properties: { reply: { type: 'string' }, created: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'integer', nullable: true }, title: { type: 'string' } } } }, failed: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } } } } } } } } }, 400: { description: 'Unknown kind or no user message.' }, 429: { description: 'Rate limited.' }, 501: { description: 'No AI configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const member = await requireMember(event, { can: 'content' })
  const project = await requireProject(member, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as { kind?: string, messages?: unknown }
  if (body.kind !== 'feedback' && body.kind !== 'board') throw createError({ statusCode: 400, statusMessage: 'kind must be "feedback" or "board"' })
  return await createCardsFromChat(member, project, body.kind, readAiChatMessages(body.messages))
})
