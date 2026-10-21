// The link in a lead form's confirmation email opens a page with one button:
// mail scanners open links, and opening must not confirm anyone.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const token = getRouterParam(event, 'token') || ''
  const link = readLeadConfirmToken(token)
  const project = link ? await loadProjectUnscoped(link.projectId).catch(() => null) : null
  if (!project) {
    setResponseStatus(event, 400)
    return leadMessagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, wantedLocales(event), 'expired')
  }
  return leadConfirmPage(project, token, link!.locale, await poweredByFor(project))
})
