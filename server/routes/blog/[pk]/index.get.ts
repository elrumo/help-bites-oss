import { createHash } from 'node:crypto'

// The hosted blog: /blog/<public key>, its published posts, newest first.
// `?tag=` narrows it and `?page=` pages it, twelve at a time.

const PER_PAGE = 12

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'")
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  const config = project ? getBlogConfig(project) : null
  if (!project || !config?.enabled) {
    setResponseStatus(event, 404)
    return project ? messagePage(pageBrand(project), 'No blog here', 'This project has not published a blog.') : invalidLinkPage()
  }
  const query = getQuery(event)
  const tag = typeof query.tag === 'string' ? query.tag.trim().slice(0, 40) : ''
  const page = Math.min(Math.max(Number.parseInt(String(query.page || '1'), 10) || 1, 1), 1000)
  const ctx = { project, config, actor: { kind: 'anonymous' as const } }
  const blog = await listPublicBlog(ctx, { limit: PER_PAGE, skip: (page - 1) * PER_PAGE, tag: tag || undefined })
  const blogPath = `/blog/${encodeURIComponent(String(project.get('publicKey')))}`
  const html = renderBlogIndex(blogPageProject(project), config, {
    // Each card opens the hosted post: this is the hosted blog, wherever the canonical copy lives.
    posts: blog.posts.map(post => ({ ...post, path: `${blogPath}/${encodeURIComponent(post.slug)}` })),
    tag,
    page,
    hasMore: blog.hasMore,
    blogPath,
    feedUrl: blogFeedUrl(project),
    canonical: hostedBlogUrl(project)
  }, await poweredByFor(project))
  if (handleCacheHeaders(event, { etag: createHash('sha1').update(html).digest('hex'), maxAge: 60, cacheControls: ['public', 'must-revalidate'] })) return
  return html
})
