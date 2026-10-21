// Baseline headers for every response. Only the embed (framed by connected
// sites), the hosted sign-up, lead form and pricing pages (link to them or iframe them) and the public
// brand page (brand.js frames it into any site) may be framed
// cross-origin; the panel must never be, or a hostile page can clickjack an
// operator's session. SAMEORIGIN rather than DENY keeps any same-origin frame
// working. A route that sets its own header later still wins.
// event.path keeps the query string: the widget frames `/embed?pk=…`.
// /pricing/<pk>/… only: the cloud edition's own /pricing page is not for framing.
const FRAMEABLE = /^\/(embed|s|f|brand|p)([/?]|$)|^\/pricing\/[^/?]+\//

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  })
  if (!FRAMEABLE.test(event.path)) {
    setResponseHeaders(event, {
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'"
    })
  }
})
