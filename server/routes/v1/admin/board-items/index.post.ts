import { clientSource } from '../../../../utils/clientSource'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'createBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a board item',
    description: 'Adds an item to the bottom of its status column with the board’s next `number`. `status` defaults to the board’s default status and `labels` must be keys the board defines. Items are private until `public` is set; a public item shows on the roadmap once its status is planned, in progress or done, with only its `publicDescription`. `kind` is `task` (default) or `epic` (groups cards). A card takes an `epicId` (id or `#N` of an epic of this project) and a `releaseId` (the id of a changelog release of this project, from GET /v1/admin/changelog/releases, which the release picker creates too); an epic takes a `releaseId` as well. Optional `feedbackPostIds` (ids or `#N`) and `conversationIds` link the item on creation; every one must belong to the project.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', description: 'Up to 200 characters', example: 'CSV export' },
      kind: { type: 'string', enum: ['task', 'epic'], default: 'task' },
      epicId: { type: 'string', description: 'The epic this card belongs to (id or #N); empty for none' },
      releaseId: { type: 'string', description: 'The changelog release this card or epic ships in (its id); empty for none' },
      description: { type: 'string', description: 'Internal Markdown; never public' },
      publicDescription: { type: 'string', description: 'What the roadmap shows' },
      status: { type: 'string', example: 'planned' },
      priority: { type: 'string', enum: ['', 'low', 'normal', 'high', 'urgent'] },
      assigneeId: { type: 'string', description: 'An agent id; empty for nobody' },
      labels: { type: 'array', items: { type: 'string' } },
      attachments: { type: 'array', maxItems: 10, items: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } }, description: 'Images and files from POST /v1/feedback/attachments' },
      targetDate: { type: 'string', format: 'date', nullable: true },
      estimate: { type: 'number', nullable: true, description: 'Effort in points, 0 to 1000; null clears it. An epic shows the total of its cards as `progress.estimateTotal` and `progress.estimateDone`.' },
      public: { type: 'boolean', default: false },
      rank: { type: 'number', description: 'Sort key within a column; lower comes first' },
      feedbackPostIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      conversationIds: { type: 'array', items: { type: 'string' }, maxItems: 50 }
    } } } } },
    responses: { 200: { description: 'The created item.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' } } } } } }, 400: { description: 'Missing title, or an unknown status, label, priority or assignee.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project, post or conversation not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const projectId = String(getQuery(event).project || '')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  const project = await requireProject(ctx, projectId)
  const row = await createBoardItem(project, ctx.agent, await readBody(event).catch(() => ({})), clientSource(event))
  return { item: await serializeBoardItem(project, row) }
})
