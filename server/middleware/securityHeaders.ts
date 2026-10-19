// Baseline headers for every response. Only the embed (framed by connected
// sites) and the hosted sign-up page (link to it or iframe it) may be framed
// cross-origin; the panel must never be, or a hostile page can clickjack an
// operator's session. SAMEORIGIN rather than DENY keeps any same-origin frame
// working. A route that sets its own header later still wins.
// event.path keeps the query string: the widget frames `/embed?pk=…`.
const FRAMEABLE = /^\/(embed|s)([/?]|$)/

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
