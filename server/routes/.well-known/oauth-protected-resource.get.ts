import { protectedResource } from '../../utils/mcp/metadata'

defineRouteMeta({ openAPI: { tags: ['MCP'], summary: 'OAuth protected resource metadata', description: 'What an AI assistant reads after a 401 from `/mcp` to find where to sign in (RFC 9728). Unauthenticated.', responses: { 200: { description: '`{ resource, authorization_servers }`' } } } })

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  // The addresses follow the host the request came in on when APP_URL is not set: a shared cache must not hand one host's answer to another.
  setHeader(event, 'Vary', 'Host, X-Forwarded-Host, X-Forwarded-Proto')
  return protectedResource(event)
})
