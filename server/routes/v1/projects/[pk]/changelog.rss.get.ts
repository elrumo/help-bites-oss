import { CHANGELOG_TAG_LABELS, type PublicChangelogEntry } from '#shared/changelog'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'changelogFeed',
    summary: 'Changelog RSS',
    description: 'The published changelog entries as RSS 2.0, newest first (the latest 50). Unauthenticated. An entry in a release that is still a draft is not in the feed. Each item links to the public changelog page, `/changelog/<pk>`.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' }, description: 'Project public key' }],
    responses: { 200: { description: 'RSS 2.0', content: { 'application/rss+xml': { schema: { type: 'string' } } } }, 404: { description: 'Unknown project, or no changelog.' } }
  }
})

function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function cdata(html: string): string {
  return `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

export default defineEventHandler(async (event) => {
  const pk = getRouterParam(event, 'pk') || ''
  const project = await findProjectByPublicKey(pk)
  if (!project || !changelogIsPublic(project)) throw createError({ statusCode: 404, statusMessage: 'No changelog here' })
  const config = getFeedbackConfig(project)

  const { releases, entries } = await listPublicChangelog(project)
  const versionOf = new Map(releases.flatMap(release => release.entries.map(entry => [entry.id, release.version] as const)))
  const when = (entry: PublicChangelogEntry) => new Date(entry.publishedAt || Date.now()).toUTCString()
  const items = [...releases.flatMap(release => release.entries), ...entries]
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, 50)

  const name = String(project.get('name') || 'Changelog')
  const siteUrl = String(project.get('siteUrl') || '').replace(/\/+$/, '')
  const page = `${getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin}/changelog/${encodeURIComponent(pk)}`

  const body = items.map((entry) => {
    const version = versionOf.get(entry.id)
    // Rendered and sanitised when the entry was saved.
    const html = entry.bodyHtml
    return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(`${page}#entry-${entry.number ?? entry.id}`)}</link>
      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>
      <pubDate>${when(entry)}</pubDate>
      <category>${escapeXml(CHANGELOG_TAG_LABELS[entry.tag])}</category>
${version ? `      <category>${escapeXml(version)}</category>\n` : ''}      <description>${cdata(html)}</description>
    </item>`
  }).join('\n')

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(config.title || `${name} changelog`)}</title>
    <link>${escapeXml(siteUrl || page)}</link>
    <description>${escapeXml(config.description || `What's new in ${name}`)}</description>
    <lastBuildDate>${items[0] ? when(items[0]) : new Date().toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>`
})
