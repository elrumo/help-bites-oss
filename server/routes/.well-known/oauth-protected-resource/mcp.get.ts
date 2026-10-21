import { protectedResource } from '../../../utils/mcp/metadata'

// The same document under the path-suffixed address RFC 9728 gives a resource served at /mcp.
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return protectedResource(event)
})
