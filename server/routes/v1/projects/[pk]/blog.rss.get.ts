import { blogTitle, fillBlogPostUrl } from '#shared/blog'

defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'blogFeed',
    summary: 'Blog RSS',
    description: 'The latest 30 published posts as RSS 2.0, newest first, each with its full sanitised HTML and cover image. Unauthenticated. Scheduled posts join once their date passes. Each item links where the post lives: the project\'s own site when the blog\'s `postUrl` is set, else the hosted page `/blog/<pk>/<slug>`.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' }, description: 'Project public key' }],
    responses: { 200: { description: 'RSS 2.0', content: { 'application/rss+xml': { schema: { type: 'string' } } } }, 404: { description: 'Unknown project, or no blog.' } }
  }
})

function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function cdata(html: string): string {
  return `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

export default defineEventHandler(async (event) => {
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  const config = project ? getBlogConfig(project) : null
  if (!project || !config?.enabled) throw createError({ statusCode: 404, statusMessage: 'No blog here' })

  const rows = await new (useParse()).Query('BlogPost').equalTo('project', project).equalTo('status', 'published').lessThanOrEqualTo('publishedAt', new Date()).descending('publishedAt').limit(30).find(MASTER)
  const name = String(project.get('name') || '')
  const when = (row: ParseObject) => ((row.get('publishedAt') as Date | undefined) || new Date()).toUTCString()
  // The configured address, not the request's Host: the feed is publicly cached, so a forged header would be served to everyone.
  const self = blogFeedUrl(project)
  const home = fillBlogPostUrl(config.postUrl, String(project.get('siteUrl') || ''), '').replace(/\/+$/, '') || hostedBlogUrl(project)

  const items = rows.map((row) => {
    const url = blogPostUrl(project, row)
    const cover = String(row.get('coverImageUrl') || '')
    // Rendered and sanitised when the post was saved.
    const html = `${cover ? `<p><img src="${escapeXml(cover)}" alt=""></p>` : ''}${String(row.get('bodyHtml') || '')}`
    const tags = (row.get('tags') as string[] | undefined) || []
    return `    <item>
      <title>${escapeXml(row.get('title'))}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="false">${escapeXml(row.id)}</guid>
      <pubDate>${when(row)}</pubDate>
${row.get('authorName') ? `      <dc:creator>${escapeXml(row.get('authorName'))}</dc:creator>\n` : ''}${tags.map(tag => `      <category>${escapeXml(tag)}</category>\n`).join('')}      <description>${escapeXml(row.get('excerpt'))}</description>
      <content:encoded>${cdata(html)}</content:encoded>
    </item>`
  }).join('\n')

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(blogTitle(config, name))}</title>
    <link>${escapeXml(home)}</link>
    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(config.description || `News and writing from ${name}`)}</description>
    <lastBuildDate>${rows[0] ? when(rows[0]) : new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`
})
