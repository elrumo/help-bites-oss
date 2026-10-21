import { createHash } from 'node:crypto'

// The project's public hub: /hub/<public key>. One page that gathers its
// changelog, roadmap, feedback board, blog, legal documents and brand kit, with
// a way to chat. Off (404) until Project -> Settings -> Public hub is switched on.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  const project = await publicHubProject(event).catch((error) => {
    if ((error as { statusCode?: number }).statusCode === 404) return null
    throw error
  })
  if (!project || !normalizeHubConfig(project.get('hub')).enabled) {
    setResponseStatus(event, 404)
    return project ? messagePage(pageBrand(project), 'No hub here', 'This project has not turned its public page on.') : invalidLinkPage()
  }
  setResponseHeader(event, 'Content-Security-Policy', HUB_PAGE_CSP)
  const html = renderHubPage(await buildHub(project, hubOrigin(event)), await poweredByFor(project))
  if (handleCacheHeaders(event, { etag: `"${createHash('sha1').update(html).digest('hex')}"`, maxAge: 60, cacheControls: ['public', 'must-revalidate'] })) return
  return html
})
