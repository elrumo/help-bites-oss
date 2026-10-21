// The unsubscribe link in every changelog email, for projects with no page of
// their own. A GET only shows the button.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  const token = getRouterParam(event, 'token') || ''
  const project = await changelogLinkProject(token, 'unsub')
  if (project) return changelogUnsubscribePage(token, pageBrand(project, await poweredByFor(project)))
  // A signed link whose subscription is gone: nothing is subscribed, which is what they came for.
  const link = verifyChangelogToken(token)
  if (link.valid && link.purpose === 'unsub') return changelogUnsubscribedPage(HELPBITES_BRAND)
  setResponseStatus(event, 400)
  return invalidLinkPage()
})
