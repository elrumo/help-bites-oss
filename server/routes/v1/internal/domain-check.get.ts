import { normalizeHost } from '#shared/domains'

defineRouteMeta({
  openAPI: {
    tags: ['Meta'], operationId: 'internalDomainCheck',
    summary: 'Is this host registered? (internal)',
    description: 'For the reverse proxy, not for integrators: Caddy\'s on-demand TLS `ask` calls it before it gets a certificate for a new host. 200 only for a custom domain that has been verified; 404 for everything else, so a certificate is never issued for a host nobody registered.',
    parameters: [{ name: 'domain', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'A verified custom domain.' }, 404: { description: 'Not a registered host.' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:domaincheck:${clientIp(event) || 'ip'}`, 120, 60)
  const host = normalizeHost(getQuery(event).domain)
  if (!host || !(await findProjectByHost(host))) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return { ok: true }
})
