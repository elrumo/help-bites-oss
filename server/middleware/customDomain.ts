import { normalizeHost, routeForHost } from '#shared/domains'

// A request that came in on a project's custom host (feedback.lightbites.app)
// becomes the same request for that project's public pages: the key is filled
// into /blog, /legal, /changelog… and everything that is not a public page
// (the panel, /v1/admin, login) is a 404. The app's own host skips all of it
// without a lookup. "/" is prerendered, which Nitro serves before any
// middleware, so the reverse proxy sends it to /_domain (see the Caddyfile).
// Every other page is fetched again from inside the app with the key filled in.

const hostOf = (url: string) => {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

export default defineEventHandler(async (event) => {
  // Not a public DNS name (localhost, an IP, the compose service name a health check uses): never a custom domain.
  const host = normalizeHost(getRequestHost(event, { xForwardedHost: true }))
  if (!host || host === hostOf(process.env.APP_URL || '') || host === hostOf(process.env.ADMIN_URL || '')) return
  // Fail open: a lookup that throws leaves the app's own pages working rather than taking every host down.
  const found = await findProjectByHost(host).catch((error) => {
    console.warn('[customDomain] host lookup failed:', (error as Error).message)
    return null
  })
  if (!found) return
  event.context.customHost = { host, publicKey: found.publicKey, target: found.target }
  const route = routeForHost(event.path, found.publicKey)
  if (route.kind === 'notFound') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (route.kind !== 'rewrite') return
  // h3 gives each layer the original path, so a rewrite is a second request inside the app (it passes this middleware again: it names the key now).
  if (event.method !== 'GET' && event.method !== 'HEAD') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const { 'accept-encoding': _encoding, 'content-length': _length, ...headers } = getRequestHeaders(event)
  return sendWebResponse(event, await useNitroApp().localFetch(route.path, { method: event.method, headers: headers as Record<string, string> }))
})
