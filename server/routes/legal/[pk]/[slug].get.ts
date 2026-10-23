import { createHash } from 'node:crypto'

// A published legal document, styled with the project's branding.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  // The page is plain HTML with no script and loads only images; nothing else is allowed to run or load.
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'")
  const project = await publicLegalProjectOrNull(event)
  const row = project ? await publicLegalDocument(project, getRouterParam(event, 'slug') || '').catch(() => null) : null
  if (!project || !row) {
    setResponseStatus(event, 404)
    return project ? messagePage(pageBrand(project), 'Not found', 'This document does not exist or is not published.') : invalidLinkPage()
  }
  const published = await listLegalDocuments(project, true)
  const doc = toPublicLegalDocument(project, row, published)
  // Other documents in the same language; the same text in other languages is linked as its own list.
  const others = published.filter(r => r.id !== row.id && String(r.get('locale') || 'en') === doc.locale).map(r => toPublicLegalDocument(project, r)).map(d => ({ title: d.title, path: d.url }))
  const page = renderLegalPage(project, { ...doc, html: doc.html, sections: sectionsOf(row), path: doc.url, origin: customOrigin(event) || String(process.env.APP_URL || '').trim().replace(/\/+$/, '') }, others, await poweredByFor(project))
  if (handleCacheHeaders(event, { etag: createHash('sha1').update(page).digest('hex'), maxAge: 60, cacheControls: ['public', 'must-revalidate'] })) return
  return page
})
