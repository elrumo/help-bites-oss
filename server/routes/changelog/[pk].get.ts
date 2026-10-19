// The public changelog's own URL: /changelog/<public key>. The page is the
// feedback embed showing only its Changelog view, like /roadmap/<public key>.
// `theme` (light, dark, system) passes through.
export default defineEventHandler((event) => {
  const pk = getRouterParam(event, 'pk') || ''
  const query = getQuery(event)
  const params = new URLSearchParams({ pk, view: 'changelog', only: 'changelog' })
  const theme = String(query.theme || '')
  if (/^[a-z]{1,20}$/.test(theme)) params.set('theme', theme)
  return sendRedirect(event, `/embed/feedback?${params.toString()}`, 302)
})
