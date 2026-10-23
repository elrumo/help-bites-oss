import { createHash } from 'node:crypto'
import { BRAND_SECTIONS, type BrandSection } from '#shared/brand'

// The public brand page. `template`, `theme`, `radius`, `accent` and `sections`
// (comma-separated) override the kit's own settings for this view, which is how
// brand.js embeds pass their options (`shadow` too); `embed=1` drops the top bar and reports
// the height to the frame.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  const project = await publicBrandProject(event).catch((error) => {
    if ((error as { statusCode?: number }).statusCode === 404) return null
    throw error
  })
  if (!project) {
    setResponseStatus(event, 404)
    return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#18181b' }, 'No brand kit here', 'This brand kit does not exist or is not public.')
  }
  setResponseHeader(event, 'Content-Security-Policy', BRAND_PAGE_CSP)
  const query = getQuery(event)
  const sections = String(query.sections || '').split(',').map(s => s.trim()).filter((s): s is BrandSection => BRAND_SECTIONS.includes(s as BrandSection))
  const assets = (await listBrandAssets(project, true)).map(row => serializeBrandAsset(project, row))
  const page = renderBrandPage(brandPageData(project, brandConfigOf(project), assets), await poweredByFor(project), {
    template: String(query.template || '') as never,
    theme: String(query.theme || '') as never,
    radius: String(query.radius || '') as never,
    accent: String(query.accent || ''),
    shadow: String(query.shadow || '') as never,
    sections,
    embed: query.embed === '1'
  })
  if (handleCacheHeaders(event, { etag: `"${createHash('sha1').update(page).digest('hex')}"`, maxAge: 60, cacheControls: ['must-revalidate'] })) return
  return page
})
