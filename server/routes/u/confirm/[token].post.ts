import { normalizeMarketingConfig } from '#shared/marketing'

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  const project = await confirmSignup(event, getRouterParam(event, 'token') || '')
  if (!project) {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 400)
    return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, 'This link has expired', 'Confirmation links work for seven days. Sign up again to get a new one.')
  }
  const next = normalizeMarketingConfig(project.get('marketing')).confirmRedirectUrl
  if (next) return sendRedirect(event, next, 303)
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return messagePage(pageBrand(project, await poweredByFor(project)), 'You are subscribed', `Thanks for confirming. You will hear from ${project.get('name') || 'us'} soon.`)
})
