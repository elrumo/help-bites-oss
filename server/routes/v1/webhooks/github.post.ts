import { verifyGithubSignature } from '../../../utils/github'

defineRouteMeta({
  openAPI: {
    tags: ['GitHub'], operationId: 'githubWebhook', security: [{}],
    summary: 'GitHub push events',
    description: 'The GitHub App\'s webhook (docs/GITHUB.md). Signed with GITHUB_APP_WEBHOOK_SECRET. A push to a repo\'s default branch drafts changelog entries from its commits for every project that uses the repo and turned on AI changelog drafting on push; other events are acknowledged and ignored.',
    responses: { 200: { description: 'Accepted (or not an event we act on).' }, 401: { description: 'Bad signature.' }, 503: { description: 'GITHUB_APP_WEBHOOK_SECRET is not set.' } }
  }
})

export default defineEventHandler(async (event) => {
  if (!githubWebhookSecret()) throw createError({ statusCode: 503, statusMessage: 'GITHUB_APP_WEBHOOK_SECRET is not set' })
  await rateLimit(`sb:rl:ghwh:${clientIp(event) || 'ip'}`, 600, 60)
  const raw = (await readRawBody(event, 'utf8')) || ''
  if (!verifyGithubSignature(raw, getHeader(event, 'x-hub-signature-256') || '')) throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  if (getHeader(event, 'x-github-event') !== 'push') return { ok: true, ignored: true }

  // GitHub redelivers on a timeout: one delivery id is acted on once.
  const delivery = getHeader(event, 'x-github-delivery') || ''
  if (delivery && await useRedis().set(`sb:ghwh:${delivery.slice(0, 80)}`, '1', 'EX', 24 * 3600, 'NX').catch(() => 'OK') !== 'OK') return { ok: true, duplicate: true }

  let payload: unknown
  try { payload = JSON.parse(raw) } catch { throw createError({ statusCode: 400, statusMessage: 'Not JSON' }) }
  return { ok: true, queued: await handleGithubPush(payload) }
})
