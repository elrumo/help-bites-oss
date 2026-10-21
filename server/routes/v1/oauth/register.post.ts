import { registerClient } from '../../../utils/mcp/oauth'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'], operationId: 'registerOAuthClient', security: [{}],
    summary: 'Register an AI assistant (OAuth dynamic client registration)',
    description: 'RFC 7591. An assistant sends its name and redirect addresses and gets a `client_id`; there is no client secret (PKCE protects the exchange). Nothing is stored: the id is the registration, signed. Needs HELPBITES_SECRET on the server.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['redirect_uris'], properties: { client_name: { type: 'string', example: 'Claude' }, redirect_uris: { type: 'array', items: { type: 'string' }, example: ['https://claude.ai/api/mcp/auth_callback'] } } } } } },
    responses: { 201: { description: 'The registration, with its `client_id`.' }, 400: { description: '`invalid_redirect_uri`.' }, 503: { description: 'HELPBITES_SECRET is not set.' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:mcp-register:${clientIp(event) || 'ip'}`, 20, 3600)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  let registered
  try {
    registered = registerClient(body && typeof body === 'object' ? body : {})
  } catch (error) {
    const data = (error as { data?: { error?: string, error_description?: string } }).data
    if (!data?.error) throw error
    setResponseStatus(event, 400)
    return data
  }
  setResponseStatus(event, 201)
  setHeader(event, 'Cache-Control', 'no-store')
  return { client_id: registered.clientId, client_name: registered.client.name, redirect_uris: registered.client.redirectUris, grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }
})
