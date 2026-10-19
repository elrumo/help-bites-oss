import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Set a new password from a reset token',
    description: 'Consumes the token from the emailed link and sets a new password. Every session of the account ends, and so do its admin API keys unless `revokeApiKeys` is false.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 }, revokeApiKeys: { type: 'boolean', default: true } } } } } },
    responses: { 200: { description: '{ ok, revokedApiKeys }' }, 400: { description: 'Bad or expired token' }, 429: { description: 'Rate limited' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:login:${clientIp(event) || 'ip'}`, LIMITS.adminLoginPerIp.limit, LIMITS.adminLoginPerIp.window)
  const { token, password, revokeApiKeys } = (await readBody(event).catch(() => ({}))) as { token?: string, password?: string, revokeApiKeys?: boolean }

  const agentId = token ? readResetToken(process.env.PARSE_MASTER_KEY || '', token) : null
  if (!agentId) throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired' })
  if (!password || password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })

  // A link works once: Redis remembers a used token for longer than it lives.
  const usedKey = `sb:pwreset:${createHash('sha256').update(token!).digest('hex')}`
  const first = await useRedis().set(usedKey, '1', 'EX', 60 * 60, 'NX').catch(() => {
    throw createError({ statusCode: 503, statusMessage: 'Could not check the reset link; try again in a moment' })
  })
  if (first !== 'OK') throw createError({ statusCode: 400, statusMessage: 'This reset link has already been used' })

  await setAgentPassword(agentId, password).catch(async (error) => {
    await useRedis().del(usedKey).catch(() => {})
    throw error
  })
  // A reset is how a stolen account is taken back: every session ends with it,
  // and so do its API keys (one minted by whoever had the account would
  // outlive the reset), unless the owner says they are theirs to keep.
  await revokeAgentSessions(agentId)
  const revokedApiKeys = revokeApiKeys === false ? 0 : await revokeAgentApiKeys(agentId)
  return { ok: true, revokedApiKeys }
})
