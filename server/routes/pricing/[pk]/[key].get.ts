import { parseAcceptLanguage } from '#shared/locales'

// A pricing table's hosted page: link to it, or put it in an iframe. Checkout comes back here when the table names nowhere else.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
  const pk = getRouterParam(event, 'pk') || ''
  const found = await findPublishedPricingTable(pk, getRouterParam(event, 'key') || '').catch(() => null)
  if (!found) {
    setResponseStatus(event, 404)
    return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, 'This page is not here', 'It may have been moved or taken down.')
  }
  const q = getQuery(event)
  const locales = [q.locale, ...parseAcceptLanguage(getHeader(event, 'accept-language'))]
  const table = await pricingTableForApps(event, found.project, found.row, found.published, locales, { currency: String(q.currency || '') })
  return pricingPage(table, pk, { checkout: String(q.checkout || ''), poweredBy: await poweredByFor(found.project) })
})
