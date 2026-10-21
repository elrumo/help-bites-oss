export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const token = getRouterParam(event, 'token') || ''
  const project = await changelogLinkProject(token, 'confirm')
  const confirmed = project ? await confirmChangelogSubscription(token).then(() => true, () => false) : false
  if (!project || !confirmed) {
    setResponseStatus(event, 400)
    return messagePage(project ? pageBrand(project) : HELPBITES_BRAND, 'This link has expired', 'Confirmation links work for seven days. Subscribe again to get a new one.')
  }
  return changelogConfirmedPage(project, pageBrand(project, await poweredByFor(project)))
})
