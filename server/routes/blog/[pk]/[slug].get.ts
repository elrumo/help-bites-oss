import { createHash } from 'node:crypto'
import type { PublicBlogPost } from '#shared/blog'

// One published post or page, in the blog's design. The page is plain HTML;
// the only script is this server's own blog.js, for reactions, comments, the
// newsletter sign-up and, on a members-only post, signing the reader in for
// the rest of it. Rendered for nobody in particular (it is cached): a
// members-only post comes locked.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', `default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src ${BLOG_EMBED_HOSTS.map(host => `https://${host}`).join(' ')}; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`)
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  const config = project ? getBlogConfig(project) : null
  const row = project && config?.enabled ? await findBlogPost(project, getRouterParam(event, 'slug') || '') : undefined
  if (!project || !config?.enabled || !row || !isBlogPostRowLive(row)) {
    setResponseStatus(event, 404)
    return project ? messagePage(pageBrand(project), 'Not found', 'This post does not exist or is not published.') : invalidLinkPage()
  }
  const post = serializePublicBlogPost(project, config, row, '', { body: true })
  const blogPath = `/blog/${encodeURIComponent(String(project.get('publicKey')))}`
  const item = (one: PublicBlogPost) => ({ ...one, path: `${blogPath}/${encodeURIComponent(one.slug)}` })
  const listed = (one: ParseObject | undefined) => one ? item(serializePublicBlogPost(project, config, one, '')) : null
  const [adjacent, related] = await Promise.all([adjacentBlogPosts(project, row), relatedBlogPosts(project, row)])
  const html = renderBlogPost(blogPageProject(project, config), config, {
    ...item(post),
    bodyHtml: post.bodyHtml || '',
    // Where it first appeared, else the project's own site when the post lives there too, else here.
    canonical: post.canonicalUrl || post.url
  }, {
    blogPath,
    feedUrl: blogFeedUrl(project),
    scriptSrc: '/blog.js',
    blogUrl: hostedBlogUrl(project, '', customOrigin(event) || undefined),
    related: related.map(one => listed(one)!),
    newer: listed(adjacent.newer),
    older: listed(adjacent.older),
    // Whether this page can sign a reader in for a members-only post: email-only readers.
    members: anonymousEnabled(project)
  }, await poweredByFor(project))
  if (handleCacheHeaders(event, { etag: createHash('sha1').update(html).digest('hex'), maxAge: 60, cacheControls: ['public', 'must-revalidate'] })) return
  return html
})
