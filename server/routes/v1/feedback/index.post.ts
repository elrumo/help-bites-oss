defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'createFeedback', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Post to a feedback board',
    description: 'Creates a post authored by the token’s user (who starts with their own vote) or, for operators (`?project=<id>`), by the team. `type`, `platform` and `tags` must be keys the board defines. The post gets the board’s next `number`, and its author follows it. Admin-only keys (`status`, `hidden`, `featured`, `locked`, `showOnChangelog`, `changelogTitle`, `changelogBody`, `shippedIn`, `icon`, `adminNote`, `completedAt`, `metadata`, `externalId`) are ignored for everyone else.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', description: 'Up to 200 characters', example: 'Export bookmarks as CSV' },
      body: { type: 'string', description: 'Markdown or HTML, up to 20,000 characters; stored as sent, sanitize when rendering', example: 'It would help me move my library to a spreadsheet.' },
      type: { type: 'string', example: 'feature' }, platform: { type: 'string', example: 'web' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      attachments: { type: 'array', maxItems: 10, items: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } }, description: 'Images and files from POST /v1/feedback/attachments' },
      status: { type: 'string' }, hidden: { type: 'boolean' }, featured: { type: 'boolean' }, showOnChangelog: { type: 'boolean' },
      changelogTitle: { type: 'string' }, changelogBody: { type: 'string' }, icon: { type: 'string' }, completedAt: { type: 'string', format: 'date-time' },
      metadata: { type: 'object' }, externalId: { type: 'string' }
    } } } } },
    responses: { 200: { description: 'The created post.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/FeedbackPost' } } } } } }, 400: { description: 'Missing title or unknown type/platform/status.' }, 401: { description: 'Sign in to post.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event, { requireActor: true })
  const row = await createFeedbackPost(ctx, await readBody(event).catch(() => ({})))
  return { post: await feedbackPostForViewer(ctx, row) }
})
