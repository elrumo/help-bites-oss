import { readChangelogTokenInput } from '#shared/changelog'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'unsubscribeFromChangelog', security: [{}],
    summary: 'Unsubscribe from the changelog emails',
    description: 'Stops the emails the signed link was made for. The token never expires (an unsubscribe link that stops working becomes a spam complaint). It is read from the JSON body or from `?token=`: the second is the RFC 8058 one-click form, which a mail provider POSTs (`List-Unsubscribe=One-Click`) straight to the URL in the `List-Unsubscribe` header. An unknown subscription is a success: there is nothing subscribed.',
    parameters: [{ name: 'token', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' } } } } } },
    responses: { 200: { description: 'Unsubscribed.' }, 400: { description: 'The link is invalid.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:clunsub:${clientIp(event) || 'ip'}`, 60, 60)
  setHeader(event, 'Cache-Control', 'no-store')
  // A one-click POST carries a form body, not JSON: whatever it is, the token is in the query.
  await unsubscribeChangelogByToken(readChangelogTokenInput(await readBody(event).catch(() => ({})), getQuery(event).token))
  return { ok: true }
})
