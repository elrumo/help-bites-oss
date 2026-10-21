import { useNitroApp } from 'nitropack/runtime'
import { handleMcpBody, mcpParseError, type McpCall } from '../utils/mcp/protocol'
import { publicOrigin } from '../utils/mcp/oauth'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'], operationId: 'mcp', security: [{ AdminApiKey: [] }, { AgentSession: [] }],
    summary: 'Model Context Protocol server',
    description: 'Lets an AI assistant (Claude, ChatGPT, Cursor, anything that speaks MCP) work in your workspace: Streamable HTTP, JSON-RPC 2.0, stateless. Authenticate with an admin API key as `Authorization: Bearer ak_…`, or let the assistant sign in through OAuth (discovery starts at `/.well-known/oauth-protected-resource`). Each tool is a `/v1/admin` call made as the key\'s operator, so roles, the workspace and a key\'s project limit all apply. The tools are listed in docs/MCP.md.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['jsonrpc', 'method'], properties: { jsonrpc: { type: 'string', example: '2.0' }, id: { type: 'integer', example: 1 }, method: { type: 'string', example: 'tools/list' }, params: { type: 'object' } } } } } },
    responses: { 200: { description: 'A JSON-RPC response.' }, 202: { description: 'A notification: accepted, nothing to answer.' }, 401: { description: 'No valid key. `WWW-Authenticate` points an OAuth client at the sign-in.' } }
  }
})

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    await requireAgentIdentity(event)
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 401) throw error
    setResponseStatus(event, 401)
    // Tells an OAuth-capable assistant where to start signing in (RFC 9728).
    setHeader(event, 'WWW-Authenticate', `Bearer resource_metadata="${publicOrigin(event)}/.well-known/oauth-protected-resource/mcp"`)
    return { jsonrpc: '2.0', id: null, error: { code: -32001, message: (error as { statusMessage?: string }).statusMessage || 'Authentication required' } }
  }

  const body = await readBody(event).catch(() => undefined)
  if (body === undefined) {
    setResponseStatus(event, 400)
    return mcpParseError()
  }

  // Each tool is an internal request to its /v1 route, carrying the caller's own credentials: the route authenticates, scopes and rate-limits exactly as it would for the panel.
  const headers: Record<string, string> = { authorization: String(getHeader(event, 'authorization') || ''), accept: 'application/json', 'content-type': 'application/json' }
  for (const name of ['x-workspace', 'x-forwarded-for']) {
    const value = getHeader(event, name)
    if (value) headers[name] = String(value)
  }
  const call: McpCall = async ({ method, url, body: payload }) => {
    const response = await useNitroApp().localFetch(url, { method, headers, body: payload ? JSON.stringify(payload) : undefined })
    const text = await response.text()
    let data: unknown = text
    try { data = text ? JSON.parse(text) : null } catch { /* not JSON: keep the text */ }
    return { status: response.status, data }
  }

  const answer = await handleMcpBody(body, call)
  if (answer === null) {
    setResponseStatus(event, 202)
    return ''
  }
  return answer
})
