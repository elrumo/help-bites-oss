// The public roadmap's own URL: /roadmap/<public key>. The page is the
// feedback embed showing only its Roadmap view, so it stays one codebase.
// `layout` (columns, timeline, list) and `theme` (light, dark, system) pass through.
export default defineEventHandler((event) => {
  const pk = getRouterParam(event, 'pk') || ''
  const query = getQuery(event)
  const params = new URLSearchParams({ pk, view: 'roadmap', only: 'roadmap' })
  for (const key of ['layout', 'theme'] as const) {
    const value = String(query[key] || '')
    if (/^[a-z]{1,20}$/.test(value)) params.set(key, value)
  }
  return sendRedirect(event, `/embed/feedback?${params.toString()}`, 302)
})
