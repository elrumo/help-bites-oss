import { readAiChatMessages } from '#shared/aiCards'
import { readItemAttachments } from '#shared/itemAttachments'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'createCardsWithAi', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Turn text into feedback posts or board items with AI',
    description: 'The AI chat on the feedback and board pages. Send the conversation so far; the AI splits the last user message into separate cards and creates them, the same way `POST /v1/feedback?project=` (`kind: "feedback"`, authored by the team) or `POST /v1/admin/board-items` (`kind: "board"`) would. On the board it can also change existing items (`updates`: a number and the fields to set, as `PATCH /v1/admin/board-items/:id` takes them) and relate items to each other (`links`, as `POST /v1/admin/board-items/:id/links` with `kind: "item"`). Items are named by number (`#12`), or by a card’s `ref` for a card the same answer creates. The AI sees the board’s 300 most recently changed items. It only uses types, tags, labels and statuses the project defines, files at most 20 cards, makes at most 20 item changes and 40 links per turn, and treats pasted text as data. Cards and changes that fail are listed in `failed`; the rest are kept and listed in `updated` (each with what changed). Metered like every AI call (workspace provider or credits). 501 when no AI is configured.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['kind', 'messages'], properties: {
      kind: { type: 'string', enum: ['feedback', 'board'] },
      attachments: { type: 'array', maxItems: 10, description: 'Images and files from `POST /v1/feedback/attachments` (each as it returned: `url`, `name`, `mime`, `size`), added to every card the message creates.' },
      messages: { type: 'array', maxItems: 12, items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string', maxLength: 20000 } } }, example: [{ role: 'user', content: 'Customers keep asking for CSV export, and iOS crashes when I open settings.' }] }
    } } } } },
    responses: { 200: { description: 'What the AI said, the cards it created and the items it changed.', content: { 'application/json': { schema: { type: 'object', properties: { reply: { type: 'string' }, created: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'integer', nullable: true }, title: { type: 'string' } } } }, updated: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'integer', nullable: true }, title: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } } } }, failed: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } } } } } } } } }, 400: { description: 'Unknown kind or no user message.' }, 429: { description: 'Rate limited.' }, 501: { description: 'No AI configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const member = await requireMember(event, { can: 'content' })
  const project = await requireProject(member, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as { kind?: string, messages?: unknown, attachments?: unknown }
  if (body.kind !== 'feedback' && body.kind !== 'board') throw createError({ statusCode: 400, statusMessage: 'kind must be "feedback" or "board"' })
  const errors: string[] = []
  const attachments = readItemAttachments(body.attachments ?? [], errors)
  if (!attachments || errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') || 'attachments must be an array' })
  return await createCardsFromChat(member, project, body.kind, readAiChatMessages(body.messages), attachments)
})
