import { createHash } from 'node:crypto'

// One published post, styled with the project's branding. The page is plain
// HTML; the only script is this server's own blog.js, for reactions, comments
// and the newsletter sign-up under the article.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'")
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  const config = project ? getBlogConfig(project) : null
  const row = project && config?.enabled ? await findBlogPost(project, getRouterParam(event, 'slug') || '') : undefined
  if (!project || !config?.enabled || !row || !isBlogPostRowLive(row)) {
    setResponseStatus(event, 404)
    return project ? messagePage(pageBrand(project), 'Not found', 'This post does not exist or is not published.') : invalidLinkPage()
  }
  const post = serializePublicBlogPost(project, config, row, '', { body: true })
  const blogPath = `/blog/${encodeURIComponent(String(project.get('publicKey')))}`
  const html = renderBlogPost(blogPageProject(project), config, {
    ...post,
    path: `${blogPath}/${encodeURIComponent(post.slug)}`,
    bodyHtml: post.bodyHtml || '',
    // The project's own site is the canonical copy when the post lives there too.
    canonical: post.url
  }, { blogPath, feedUrl: blogFeedUrl(project), scriptSrc: '/blog.js' }, await poweredByFor(project))
  if (handleCacheHeaders(event, { etag: createHash('sha1').update(html).digest('hex'), maxAge: 60, cacheControls: ['public', 'must-revalidate'] })) return
  return html
})
