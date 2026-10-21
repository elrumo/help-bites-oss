// The server keeps no sessions and never pushes: the transport's GET (a server-sent stream) and DELETE (end a session) are not offered.
export default defineEventHandler((event) => {
  setResponseStatus(event, 405)
  setHeader(event, 'Allow', 'POST')
  return { error: 'Use POST with a JSON-RPC message' }
})
