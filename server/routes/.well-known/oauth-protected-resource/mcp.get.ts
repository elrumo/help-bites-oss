import { protectedResource } from '../../../utils/mcp/metadata'

// The same document under the path-suffixed address RFC 9728 gives a resource served at /mcp.
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  // The addresses follow the host the request came in on when APP_URL is not set: a shared cache must not hand one host's answer to another.
  setHeader(event, 'Vary', 'Host, X-Forwarded-Host, X-Forwarded-Proto')
  return protectedResource(event)
})
