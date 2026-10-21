import type { H3Event } from 'h3'
import { publicOrigin } from './oauth'

// The documents an assistant fetches to learn how to sign in (RFC 9728 and 8414).

/** The MCP server and the one authorization server that protects it, which is this app. */
export function protectedResource(event: H3Event) {
  const origin = publicOrigin(event)
  return { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'HelpBites', scopes_supported: ['mcp'] }
}

export function authorizationServer(event: H3Event) {
  const origin = publicOrigin(event)
  return {
    issuer: origin,
    // A panel page, not an API route: the operator signs in with their own session and approves.
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/v1/oauth/token`,
    registration_endpoint: `${origin}/v1/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp']
  }
}
