import { authorizationServer } from '../../utils/mcp/metadata'

defineRouteMeta({ openAPI: { tags: ['MCP'], summary: 'OAuth authorization server metadata', description: 'The endpoints an AI assistant signs in through (RFC 8414): dynamic client registration, authorization code with PKCE S256, no client secret. Unauthenticated.', responses: { 200: { description: 'Endpoints and supported grants.' } } } })

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  // The addresses follow the host the request came in on when APP_URL is not set: a shared cache must not hand one host's answer to another.
  setHeader(event, 'Vary', 'Host, X-Forwarded-Host, X-Forwarded-Proto')
  return authorizationServer(event)
})
