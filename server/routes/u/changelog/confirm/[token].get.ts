// The confirm link in a changelog subscription email, for projects with no
// page of their own. A GET only shows the button.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  const token = getRouterParam(event, 'token') || ''
  const project = await changelogLinkProject(token, 'confirm')
  if (!project) {
    setResponseStatus(event, 400)
    return messagePage(HELPBITES_BRAND, 'This link has expired', 'Confirmation links work for seven days. Subscribe again to get a new one.')
  }
  return changelogConfirmPage(project, token, pageBrand(project, await poweredByFor(project)))
})
