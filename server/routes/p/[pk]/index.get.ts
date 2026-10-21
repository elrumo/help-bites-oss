import { createHash } from 'node:crypto'

// A hosted page: /p/<publicKey> is the `home` entry, /p/<publicKey>/<slug> the rest.
// Server-rendered from the published copy; the CSP lets only the page runtime and
// Motion run. `embed=1` (pages.js's iframe) reports the height to the frame.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  const project = await cmsPublicProject(event).catch((error) => {
    if ((error as { statusCode?: number }).statusCode === 404) return null
    throw error
  })
  const page = project ? await hostedCmsPage(event, project, 'home') : null
  if (!project || !page) {
    setResponseStatus(event, 404)
    setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors *")
    return messagePage({ name: String(project?.get('name') || 'HelpBites'), logoUrl: '', accent: '#18181b' }, 'Page not found', 'There is no published page at this address.')
  }
  setResponseHeader(event, 'Content-Security-Policy', page.csp)
  if (handleCacheHeaders(event, { etag: `"${createHash('sha1').update(page.html).digest('hex')}"`, maxAge: 60, cacheControls: ['must-revalidate'] })) return
  return page.html
})
