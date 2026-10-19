import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Agent login',
    description: 'Exchanges an agent\'s username (or email) and password for a Parse session token. Every /v1/admin route also accepts a general `ak_…` admin API key issued from the API Keys panel.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['password'], properties: { login: { type: 'string', description: 'Username or email' }, username: { type: 'string', description: 'Same as `login` (older clients)' }, password: { type: 'string' } } } } } },
    responses: { 200: { description: '{ sessionToken, agent }' }, 401: { description: 'Bad credentials' }, 429: { description: 'Rate limited' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:login:${clientIp(event) || 'ip'}`, LIMITS.adminLoginPerIp.limit, LIMITS.adminLoginPerIp.window)
  const body = (await readBody(event).catch(() => ({}))) as { login?: string, username?: string, password?: string }
  const login = String(body.login || body.username || '').trim()
  const password = String(body.password || '')
  if (!login || !password) throw createError({ statusCode: 400, statusMessage: 'username and password are required' })
  const who = createHash('sha256').update(login.toLowerCase()).digest('hex').slice(0, 32)
  await rateLimit(`sb:rl:login:user:${who}`, LIMITS.adminLoginPerUser.limit, LIMITS.adminLoginPerUser.window)

  const session = await loginAgent(await usernameForLogin(login), password)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Invalid username or password' })
  return session
})
