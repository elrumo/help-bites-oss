defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'oneClickUnsubscribe',
    summary: 'One-click unsubscribe (RFC 8058)',
    description: 'What mail clients call from a campaign\'s `List-Unsubscribe` header, with the body `List-Unsubscribe=One-Click`. No sign-in: the signed token in the path is the authority. Unsubscribes from the campaign\'s topic, or from all marketing email. Always 200 for a valid token.',
    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ ok: true }`' }, 400: { description: 'Not a valid unsubscribe link.' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:emaillink:${clientIp(event) || 'ip'}`, LIMITS.emailLinksPerIp.limit, LIMITS.emailLinksPerIp.window)
  const link = await loadPreferenceLink(getRouterParam(event, 'token') || '')
  if (!link) throw createError({ statusCode: 400, statusMessage: 'Not a valid unsubscribe link' })
  await unsubscribeByLink(link, 'one-click')
  return { ok: true }
})
