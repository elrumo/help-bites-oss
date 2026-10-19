import { readChangelogTokenInput } from '#shared/changelog'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'confirmChangelogSubscription', security: [{}],
    summary: 'Confirm a changelog subscription',
    description: 'Activates the subscription the emailed link was made for, at the cadence its owner asked for. The token is the signed link’s; it expires after seven days. Call it from the page the link opens (not on load: mail scanners prefetch links), with a click or a button.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } } },
    responses: { 200: { description: 'Active.', content: { 'application/json': { schema: { type: 'object', properties: { frequency: { type: 'string', enum: ['instant', 'weekly'] } } } } } }, 400: { description: 'The link is invalid or has expired.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:clconfirm:${clientIp(event) || 'ip'}`, 30, 60)
  setHeader(event, 'Cache-Control', 'no-store')
  return await confirmChangelogSubscription(readChangelogTokenInput(await readBody(event).catch(() => ({})), getQuery(event).token))
})
