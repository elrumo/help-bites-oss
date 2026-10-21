// A lead form's hosted page: link to it, or put it in an iframe (`?locale=` picks a language).

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
  const found = await findPublicLeadForm(getRouterParam(event, 'publicKey') || '', getRouterParam(event, 'key') || '').catch(() => null)
  if (!found) {
    setResponseStatus(event, 404)
    return leadMessagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, wantedLocales(event), 'closed')
  }
  // ?locale=es wins over the browser's Accept-Language, as on the public endpoint.
  setResponseHeader(event, 'Vary', 'Accept-Language')
  return leadFormPage(found.project, found.row, { sent: getQuery(event).sent === '1', poweredBy: await poweredByFor(found.project), wanted: wantedLocales(event) })
})
