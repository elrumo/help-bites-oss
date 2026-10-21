export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const token = getRouterParam(event, 'token') || ''
  const project = await changelogLinkProject(token, 'unsub')
  const done = await unsubscribeChangelogByToken(token).then(() => true, () => false)
  if (!done) {
    setResponseStatus(event, 400)
    return invalidLinkPage()
  }
  return changelogUnsubscribedPage(project ? pageBrand(project, await poweredByFor(project)) : HELPBITES_BRAND)
})
