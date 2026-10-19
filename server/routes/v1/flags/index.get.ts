import { getHeader, getQuery, createError } from 'h3'
import { flagEnabledFor, flagsForTarget, normalizeFlags, type FlagViewer } from '#shared/flags'

defineRouteMeta({
  openAPI: {
    tags: ['Feature flags'], operationId: 'getFlags', security: [{ ProjectSecret: [] }, { EndUserToken: [] }, {}],
    summary: 'Feature flags',
    description: 'The project\'s feature flags, keyed by flag key. With the project secret (server-to-server) each flag comes back raw — state, fallback, targets and the `allow` list — for the host to evaluate against its own users. With an identity token, or anonymously with `?pk=`, each flag is evaluated for the caller: `enabled` and `fallback` are booleans and the allow list is never returned. `admins` flags are on for a token carrying `role: "admin"` and for anyone on the flag\'s allow list (by `sub` or `email`). Cache the answer (≈30 s), keep the last good one through short outages, then fall back to `fallback`; treat an unknown flag as off.',
    parameters: [
      { name: 'target', in: 'query', schema: { type: 'string' }, description: 'Only flags tagged with this target (untagged flags are always included)', example: 'frontend' },
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Public key, for anonymous reads' }
    ],
    responses: {
      200: { description: 'Flags by key.', content: { 'application/json': { schema: { type: 'object', required: ['flags'], properties: { flags: { type: 'object', additionalProperties: { '$ref': '#/components/schemas/FeatureFlag' } } } }, example: { flags: { ai_chat: { state: 'admins', enabled: false, fallback: false, targets: ['frontend', 'backend'] } } } } } },
      401: { description: 'No valid secret, token or public key.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const token = optionalBearer(event)
  const query = getQuery(event)
  const target = String(query.target || '')

  // Server-to-server: raw flags, allow lists included, evaluated by the host.
  if (token.startsWith('sk_')) {
    const project = await requireProjectSecret(event)
    const flags = flagsForTarget(normalizeFlags(project.get('flags')), target)
    return { flags: Object.fromEntries(flags.map(({ key, ...rest }) => [key, rest])) }
  }

  let project: ParseObject | null
  let viewer: FlagViewer = { isAdmin: false }
  if (token) {
    if (token.startsWith('r:') || token.startsWith('ak_')) throw createError({ statusCode: 400, statusMessage: 'Operators read flags from the project; use an identity token, ?pk= or the project secret' })
    const verified = await verifyEndUserToken(event, token)
    project = verified.project
    viewer = { isAdmin: verified.claims.role === 'admin', sub: verified.claims.sub, email: verified.claims.email }
  } else {
    const pk = String(query.pk || getHeader(event, 'x-project-key') || '').trim()
    if (!pk) throw createError({ statusCode: 401, statusMessage: 'Pass ?pk=<public key>, an identity token or the project secret' })
    await rateLimit(`sb:rl:flagread:${clientIp(event) || 'ip'}`, LIMITS.flagReadsPerIp.limit, LIMITS.flagReadsPerIp.window)
    project = await findProjectByPublicKey(pk)
    if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  }

  const flags = flagsForTarget(normalizeFlags(project.get('flags')), target)
  return {
    flags: Object.fromEntries(flags.map(f => [f.key, {
      state: f.state,
      enabled: flagEnabledFor(f.state, f, viewer),
      fallback: flagEnabledFor(f.fallback, f, viewer),
      targets: f.targets
    }]))
  }
})
