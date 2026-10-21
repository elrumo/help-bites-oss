export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  const confirmed = await confirmLead(event, getRouterParam(event, 'token') || '')
  if (!confirmed) {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 400)
    return leadMessagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, wantedLocales(event), 'expired')
  }
  const { project, form, locale } = confirmed
  if (form?.settings.redirectUrl) return sendRedirect(event, form.settings.redirectUrl, 303)
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return leadConfirmedPage(project, form, locale, await poweredByFor(project))
})
