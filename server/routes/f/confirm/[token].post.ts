export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  const confirmed = await confirmLead(event, getRouterParam(event, 'token') || '')
  if (!confirmed) {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 400)
    return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, 'This link has expired', 'Confirmation links work for seven days. Sign up again to get a new one.')
  }
  const { project, form } = confirmed
  if (form?.settings.redirectUrl) return sendRedirect(event, form.settings.redirectUrl, 303)
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  const brand = pageBrand(project, await poweredByFor(project))
  return messagePage(form?.style.accent ? { ...brand, accent: form.style.accent } : brand, form?.content.successTitle || 'You are on the list', form?.content.successMessage || `Thanks for confirming. You will hear from ${project.get('name') || 'us'} soon.`)
})
