// The hosted blog's sitemap: its front page and every live post and page
// whose canonical copy is here (a post that lives on the project's own site,
// or first appeared elsewhere, belongs in that site's sitemap instead).

export default defineEventHandler(async (event) => {
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  const config = project ? getBlogConfig(project) : null
  if (!project || !config?.enabled) throw createError({ statusCode: 404, statusMessage: 'No blog here' })
  const home = hostedBlogUrl(project)
  const rows = await sitemapBlogPosts(project)
  const urls = rows
    .filter(row => !row.get('canonicalUrl') && blogPostUrl(project, row) === hostedBlogUrl(project, String(row.get('slug') || row.id || '')))
    .map(row => ({ loc: hostedBlogUrl(project, String(row.get('slug') || row.id || '')), lastmod: (row.updatedAt || new Date()).toISOString() }))
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return renderBlogSitemap([{ loc: home, lastmod: urls[0]?.lastmod || '' }, ...urls])
})
