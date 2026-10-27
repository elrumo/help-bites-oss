import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Request a password reset',
    description: 'Emails a reset link to the agent with that email. Always answers 200 so it never reveals which addresses have accounts.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } } } },
    responses: { 200: { description: '{ ok }' }, 429: { description: 'Rate limited' } }
  }
})

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:login:${clientIp(event) || 'ip'}`, LIMITS.adminLoginPerIp.limit, LIMITS.adminLoginPerIp.window)
  const { email } = (await readBody(event).catch(() => ({}))) as { email?: string }
  const address = String(email || '').trim()

  // Per address as well as per caller: many callers cannot flood one operator's inbox. Any address counts the same, known or not.
  if (address) await rateLimit(`sb:rl:forgot:${createHash('sha256').update(address.toLowerCase()).digest('hex')}`, 3, 86400)
  // Look up and send, but never let the outcome show in the response.
  if (address && isMailerConfigured()) {
    const agent = await findAgentByEmail(address)
    // Not awaited: a slower answer for known addresses would tell which are operators.
    if (agent) void sendAgentResetEmail(agent).catch(e => console.warn('[forgot-password] send failed:', (e as Error).message))
  }
  return { ok: true }
})
