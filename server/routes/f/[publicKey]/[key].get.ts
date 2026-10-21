// A lead form's hosted page: link to it, or put it in an iframe.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
  const found = await findPublicLeadForm(getRouterParam(event, 'publicKey') || '', getRouterParam(event, 'key') || '').catch(() => null)
  if (!found) {
    setResponseStatus(event, 404)
    return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, 'This form is closed', 'It may have been moved or taken down.')
  }
  return leadFormPage(found.project, found.row, { sent: getQuery(event).sent === '1', poweredBy: await poweredByFor(found.project) })
})
