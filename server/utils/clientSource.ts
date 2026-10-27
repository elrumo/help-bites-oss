import { getHeader, type H3Event } from 'h3'

export type ClientSource = 'web' | 'app' | 'api' | 'mcp'

/** Attribute an admin mutation to the panel, native app, API key, or MCP bridge. */
export function clientSource(event: H3Event): ClientSource {
  const auth = String(getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const declared = String(getHeader(event, 'x-helpbites-client') || '').toLowerCase()
  if (auth.startsWith('ak_')) return declared === 'mcp' ? 'mcp' : 'api'
  return declared === 'app' ? 'app' : 'web'
}
