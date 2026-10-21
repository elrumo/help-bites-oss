import { protectedResource } from '../../utils/mcp/metadata'

defineRouteMeta({ openAPI: { tags: ['MCP'], summary: 'OAuth protected resource metadata', description: 'What an AI assistant reads after a 401 from `/mcp` to find where to sign in (RFC 9728). Unauthenticated.', responses: { 200: { description: '`{ resource, authorization_servers }`' } } } })

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return protectedResource(event)
})
