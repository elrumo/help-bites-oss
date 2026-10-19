// Browser clients on any host call /v1 with a bearer token and no cookies, so
// a wildcard origin is safe; the preflight just needs a 204.
export default defineEventHandler((event) => {
  if (event.method === 'OPTIONS' && event.path.startsWith('/v1')) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400'
    })
    setResponseStatus(event, 204)
    return ''
  }
})
