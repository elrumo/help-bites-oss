// Browser clients on any host call /v1 (and the MCP server and its sign-in
// documents) with a bearer token and no cookies, so a wildcard origin is safe;
// the preflight just needs a 204.
const CROSS_ORIGIN = /^\/(v1|mcp|\.well-known)([/?]|$)/

export default defineEventHandler((event) => {
  if (event.method === 'OPTIONS' && CROSS_ORIGIN.test(event.path)) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace, Mcp-Protocol-Version',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400'
    })
    setResponseStatus(event, 204)
    return ''
  }
})
