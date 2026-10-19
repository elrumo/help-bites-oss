defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'createBoardItem', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a board item',
    description: 'Adds an item to the bottom of its status column with the board’s next `number`. `status` defaults to the board’s default status and `labels` must be keys the board defines. Items are private until `public` is set; a public item shows on the roadmap once its status is planned, in progress or done, with only its `publicDescription`. Optional `feedbackPostIds` (ids or `#N`) and `conversationIds` link the item on creation; every one must belong to the project.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', description: 'Up to 200 characters', example: 'CSV export' },
      description: { type: 'string', description: 'Internal Markdown; never public' },
      publicDescription: { type: 'string', description: 'What the roadmap shows' },
      status: { type: 'string', example: 'planned' },
      priority: { type: 'string', enum: ['', 'low', 'normal', 'high', 'urgent'] },
      assigneeId: { type: 'string', description: 'An agent id; empty for nobody' },
      labels: { type: 'array', items: { type: 'string' } },
      targetDate: { type: 'string', format: 'date', nullable: true },
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
  const row = await createBoardItem(project, ctx.agent, await readBody(event).catch(() => ({})))
  return { item: await serializeBoardItem(project, row) }
})
