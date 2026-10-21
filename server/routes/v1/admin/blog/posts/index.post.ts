defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'createBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a blog post',
    description: 'A draft by default. `body` is Markdown (what the panel\'s editor saves); it is rendered and sanitised once, into `bodyHtml`. The `slug` comes from the title unless you send one, and gets `-2`, `-3`… when another post has it. `status: "published"` with no `publishedAt` publishes it now; a `publishedAt` in the future schedules it. `excerpt` is taken from the body until you write one. The author is the caller (an operator or the key\'s owner) unless you send `authorName`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'title'], properties: {
      project: { type: 'string' },
      title: { type: 'string', maxLength: 200, example: 'How we cut our build time in half' },
      slug: { type: 'string', maxLength: 80 },
      excerpt: { type: 'string', maxLength: 300 },
      body: { type: 'string', description: 'Markdown, up to 100,000 characters' },
      coverImageUrl: { type: 'string', format: 'uri' },
      tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 10 },
      status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
      publishedAt: { type: 'string', format: 'date-time', nullable: true },
      commentsOpen: { type: 'boolean', default: true },
      authorName: { type: 'string' }
    } } } } },
    responses: { 200: { description: 'The new post.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/BlogPost' } } } } } }, 400: { description: 'Missing title, or an invalid value.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const project = await blogProject(ctx, event, body)
  const row = await createBlogPost(project, ctx.agent, body)
  return { post: serializeBlogPost(project, row) }
})
