defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'createBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a blog post',
    description: 'A draft post by default; `type: "page"` makes a standalone page (About, Contact) that stays out of the list, the feed and the newsletter. `body` is Markdown (what the panel\'s editor saves), or HTML with `bodyFormat: "html"`; either is rendered and sanitised once, into `bodyHtml`. The `slug` comes from the title unless you send one, and gets `-2`, `-3`… when another post has it. `status: "published"` with no `publishedAt` publishes it now; a `publishedAt` in the future schedules it. `excerpt` is taken from the body until you write one. The author is the caller (an operator or the key\'s owner) unless you send `authorName`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'title'], properties: {
      project: { type: 'string' },
      title: { type: 'string', maxLength: 200, example: 'How we cut our build time in half' },
      slug: { type: 'string', maxLength: 80 },
      excerpt: { type: 'string', maxLength: 300 },
      type: { type: 'string', enum: ['post', 'page'], default: 'post' },
      body: { type: 'string', description: 'Markdown (or HTML), up to 200,000 characters' },
      bodyFormat: { type: 'string', enum: ['markdown', 'html'], default: 'markdown' },
      coverImageUrl: { type: 'string', format: 'uri' },
      coverImageAlt: { type: 'string', maxLength: 300 },
      tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 10 },
      featured: { type: 'boolean', default: false, description: 'Shown first: large on the magazine layout, marked on the others' },
      visibility: { type: 'string', enum: ['public', 'members'], default: 'public', description: '`members`: the excerpt is public, the body is for signed-in readers' },
      metaTitle: { type: 'string', maxLength: 300, description: 'For search engines; the title when empty' },
      metaDescription: { type: 'string', maxLength: 500, description: 'For search engines and link previews; the excerpt when empty' },
      ogImageUrl: { type: 'string', format: 'uri', description: 'For link previews; the cover when empty' },
      canonicalUrl: { type: 'string', format: 'uri', description: 'Where the post first appeared, when elsewhere' },
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
