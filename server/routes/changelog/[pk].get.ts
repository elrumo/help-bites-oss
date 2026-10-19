// The public changelog's own URL: /changelog/<public key>. The page is the
// changelog embed, which needs no feedback board. `theme` (light, dark, system) passes through.
export default defineEventHandler((event) => {
  const pk = getRouterParam(event, 'pk') || ''
  const query = getQuery(event)
  const params = new URLSearchParams({ pk })
  const theme = String(query.theme || '')
  if (/^[a-z]{1,20}$/.test(theme)) params.set('theme', theme)
  return sendRedirect(event, `/embed/changelog?${params.toString()}`, 302)
})
