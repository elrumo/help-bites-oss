import { createHash } from 'node:crypto'
import type { PublicBlogPost } from '#shared/blog'

// The hosted blog: /blog/<public key>, its published posts, newest first.
// `?tag=` narrows it, `?q=` searches it and `?page=` pages it, twelve at a
// time. The magazine layout puts the newest featured post (or the newest
// post) large above the rest on the front page.

const PER_PAGE = 12

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'")
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  const config = project ? getBlogConfig(project) : null
  if (!project || !config?.enabled) {
    setResponseStatus(event, 404)
    return project ? messagePage(pageBrand(project), 'No blog here', 'This project has not published a blog.') : invalidLinkPage()
  }
  const query = getQuery(event)
  const text = (raw: unknown, max: number) => typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, max) : ''
  const tag = text(query.tag, 40)
  const q = text(query.q, 100)
  const page = Math.min(Math.max(Number.parseInt(String(query.page || '1'), 10) || 1, 1), 1000)
  const ctx = { project, config, actor: { kind: 'anonymous' as const } }
  const blogPath = `/blog/${encodeURIComponent(String(project.get('publicKey')))}`
  // Each card opens the hosted post: this is the hosted blog, wherever the canonical copy lives.
  const item = (post: PublicBlogPost) => ({ ...post, path: `${blogPath}/${encodeURIComponent(post.slug)}` })

  const front = config.design.layout === 'magazine' && !tag && !q && page === 1
  const [blog, featured] = await Promise.all([
    listPublicBlog(ctx, { limit: PER_PAGE, skip: (page - 1) * PER_PAGE, tag: tag || undefined, q: q || undefined }),
    front ? listPublicBlog(ctx, { limit: 1, skip: 0, featured: true }) : null
  ])
  const lead = front ? (featured?.posts[0] || blog.posts[0] || null) : null
  const html = renderBlogIndex(blogPageProject(project, config), config, {
    posts: blog.posts.filter(post => post.id !== lead?.id).map(item),
    lead: lead ? item(lead) : null,
    tag,
    q,
    page,
    hasMore: blog.hasMore,
    blogPath,
    feedUrl: blogFeedUrl(project),
    canonical: hostedBlogUrl(project, '', customOrigin(event) || undefined)
  }, await poweredByFor(project))
  if (handleCacheHeaders(event, { etag: createHash('sha1').update(html).digest('hex'), maxAge: 60, cacheControls: ['public', 'must-revalidate'] })) return
  return html
})
