// The preferences page's forms. Redirects back to the page (POST → GET), so a
// reload does not submit again.

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  const token = getRouterParam(event, 'token') || ''
  const link = await loadPreferenceLink(token)
  if (!link) {
    setResponseStatus(event, 400)
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return invalidLinkPage()
  }
  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>
  const done = await applyPreferenceForm(event, link, body && typeof body === 'object' ? body : {})
  return sendRedirect(event, `/u/${encodeURIComponent(token)}${done ? `?done=${done}` : ''}`, 303)
})
