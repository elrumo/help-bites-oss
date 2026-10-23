// The public changelog's own URL: /changelog/<public key>. The page is the
// changelog embed, which needs no feedback board. `theme` (light, dark, system),
// `accent`, `radius` and `shadow` pass through (see public/changelog.js).
export default defineEventHandler((event) => {
  const pk = getRouterParam(event, 'pk') || ''
  const query = getQuery(event)
  const params = new URLSearchParams({ pk })
  for (const [key, pattern] of [['theme', /^[a-z]{1,20}$/], ['accent', /^#[0-9a-f]{6}$/i], ['radius', /^\d{1,2}$/], ['shadow', /^[a-z]{1,10}$/], ['header', /^[a-z0-9]{1,5}$/i]] as const) {
    const value = String(query[key] || '')
    if (pattern.test(value)) params.set(key, value)
  }
  return sendRedirect(event, `/embed/changelog?${params.toString()}`, 302)
})
