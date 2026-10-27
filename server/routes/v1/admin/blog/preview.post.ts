import { BLOG_BODY_FORMATS, BLOG_BODY_MAX_LENGTH, type BlogBodyFormat } from '#shared/blog'

defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'previewBlogPost', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Preview a blog post',
    description: 'Renders the post as readers will see it, in the blog\'s design, from the fields you send: nothing is read from or saved to a stored post, so it works for a draft that has not been saved. Reactions, comments and the sign-up form are left out. The HTML is a whole page; show it in a sandboxed `iframe` (`srcdoc`), without scripts.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: {
      project: { type: 'string' },
      type: { type: 'string', enum: ['post', 'page'], description: 'Default `post`' },
      title: { type: 'string', maxLength: 200 },
      body: { type: 'string', description: 'Markdown, or HTML when `bodyFormat` is `html`' },
      bodyFormat: { type: 'string', enum: ['markdown', 'html'] },
      excerpt: { type: 'string', description: 'Left empty, it follows the body' },
      coverImageUrl: { type: 'string' },
      coverImageAlt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      authorName: { type: 'string' },
      publishedAt: { type: 'string', format: 'date-time', description: 'Default now' }
    } }, example: { project: 'abc123', title: 'Offline mode', body: 'It **works** on a plane.' } } } },
    responses: { 200: { description: '`{ html }`: the page.' }, 400: { description: 'Missing project, or a body that is too long.' }, 404: { description: 'Project not found.' } }
  }
})

const text = (value: unknown, max: number) => (typeof value === 'string' ? value : '').slice(0, max)

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  // A preview renders the whole post on every call (typing in the editor asks for one now and then, not many a second).
  await rateLimit(`sb:rl:blogpreview:${ctx.agent.id}`, 60, 60)
  const input = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const project = await blogProject(ctx, event, input)
  const body = typeof input.body === 'string' ? input.body : ''
  if (body.length > BLOG_BODY_MAX_LENGTH) throw createError({ statusCode: 400, statusMessage: `body is up to ${BLOG_BODY_MAX_LENGTH} characters` })
  const format: BlogBodyFormat = (BLOG_BODY_FORMATS as readonly string[]).includes(String(input.bodyFormat)) ? input.bodyFormat as BlogBodyFormat : 'markdown'
  const publishedAt = new Date(String(input.publishedAt || ''))
  const tags = Array.isArray(input.tags) ? input.tags.map(tag => text(tag, 60)).filter(Boolean).slice(0, 20) : []
  const excerpt = text(input.excerpt, 1000) || deriveBlogExcerpt(body, 200, format)
  // The reader-facing extras need the live post, which a draft is not.
  const config = { ...getBlogConfig(project), reactions: false, comments: false, subscribeForm: false }
  const blogPath = `/blog/${encodeURIComponent(String(project.get('publicKey')))}`
  const html = renderBlogPost(blogPageProject(project, config), config, {
    type: input.type === 'page' ? 'page' : 'post',
    slug: 'preview',
    title: text(input.title, 200),
    excerpt,
    coverImageUrl: /^https?:\/\//.test(text(input.coverImageUrl, 2000)) ? text(input.coverImageUrl, 2000) : '',
    coverImageAlt: text(input.coverImageAlt, 300),
    tags,
    featured: false,
    locked: false,
    metaTitle: '',
    metaDescription: '',
    ogImageUrl: '',
    publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date().toISOString() : publishedAt.toISOString(),
    authorName: text(input.authorName, 120),
    readingMinutes: blogBodyStats(body, format).readingMinutes,
    path: `${blogPath}/preview`,
    bodyHtml: renderBlogBody(body, format),
    canonical: hostedBlogUrl(project),
    commentsOpen: false
  }, {
    blogPath,
    feedUrl: blogFeedUrl(project),
    scriptSrc: '',
    blogUrl: hostedBlogUrl(project),
    related: [],
    newer: null,
    older: null,
    members: false
  }, await poweredByFor(project))
  setHeader(event, 'Cache-Control', 'no-store')
  // Links in the preview open in their own tab, never inside the frame.
  return { html: html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base target="_blank">') }
})
