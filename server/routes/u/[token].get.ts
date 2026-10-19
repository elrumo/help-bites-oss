// The preferences page marketing email links to. A GET only shows it: link
// scanners and previews open every link, so nothing here changes anything.

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  const token = getRouterParam(event, 'token') || ''
  const link = await loadPreferenceLink(token)
  if (!link) {
    setResponseStatus(event, 400)
    return invalidLinkPage()
  }
  const query = getQuery(event)
  return renderPreferencesPage(link, { token, askUnsubscribe: query.unsubscribe === '1', notice: String(query.done || ''), poweredBy: await poweredByFor(link.project) })
})
