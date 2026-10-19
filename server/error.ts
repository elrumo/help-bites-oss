import { getRequestHeader, send, setResponseHeaders, setResponseStatus } from 'h3'
import { defineNitroErrorHandler } from 'nitropack/runtime'

// /v1 errors are JSON for every API client, whatever its Accept header; Nuxt's
// handler, next in the chain (nuxt.config.ts), answers its HTML error page to
// anything but `Accept: application/json` and curl. A browser navigating to a
// /v1 URL (an export link, a sign-up form post) still gets that page.
// Nitro's defaultHandler leaves out the stack, and an unhandled error's message, in production.
export default defineNitroErrorHandler(async (error, event, { defaultHandler }) => {
  if (!event.path.startsWith('/v1/') || getRequestHeader(event, 'sec-fetch-mode') === 'navigate') return
  const res = await defaultHandler(error, event, { json: true })
  setResponseHeaders(event, res.headers)
  setResponseStatus(event, res.status, res.statusText)
  return send(event, JSON.stringify(res.body))
})
