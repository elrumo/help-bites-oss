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
    return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, 'This link has expired', 'Confirmation links work for seven days. Sign up again to get a new one.')
  }
  return leadConfirmPage(project, token, await poweredByFor(project))
})
