import { verifyGithubSignature } from '../../../utils/github'

defineRouteMeta({
  openAPI: {
    tags: ['GitHub'], operationId: 'githubWebhook', security: [{}],
    summary: 'GitHub push and pull request events',
    description: 'The GitHub App\'s webhook (docs/GITHUB.md). Signed with GITHUB_APP_WEBHOOK_SECRET. A push to a repo\'s default branch drafts changelog entries from its commits for every project that uses the repo and turned on AI changelog drafting on push, and links the commits that mention `#12` to that board item or feedback post. A pull request merged into the default branch is linked the same way; a closing keyword (`fixes #12`) in a commit or pull request also moves the board item to done. Other events are acknowledged and ignored; an install without the Pull requests permission just never sends the second.',
    responses: { 200: { description: 'Accepted (or not an event we act on).' }, 401: { description: 'Bad signature.' }, 503: { description: 'GITHUB_APP_WEBHOOK_SECRET is not set.' } }
  }
})

export default defineEventHandler(async (event) => {
  if (!githubWebhookSecret()) throw createError({ statusCode: 503, statusMessage: 'GITHUB_APP_WEBHOOK_SECRET is not set' })
  await rateLimit(`sb:rl:ghwh:${clientIp(event) || 'ip'}`, 600, 60)
  const raw = (await readRawBody(event, 'utf8')) || ''
  if (!verifyGithubSignature(raw, getHeader(event, 'x-hub-signature-256') || '')) throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  const kind = getHeader(event, 'x-github-event')
  if (kind !== 'push' && kind !== 'pull_request') return { ok: true, ignored: true }

  // GitHub redelivers on a timeout: one delivery id is acted on once.
  const delivery = getHeader(event, 'x-github-delivery') || ''
  if (delivery && await useRedis().set(`sb:ghwh:${delivery.slice(0, 80)}`, '1', 'EX', 24 * 3600, 'NX').catch(() => 'OK') !== 'OK') return { ok: true, duplicate: true }

  let payload: unknown
  try { payload = JSON.parse(raw) } catch { throw createError({ statusCode: 400, statusMessage: 'Not JSON' }) }

  if (kind === 'pull_request') return { ok: true, linked: await handleGithubPullRequest(payload) }

  // Linking commits to items never gets in the way of the changelog drafting, and the other way round.
  const linked = await recordPushRefs(payload).catch((error) => { console.warn('[github] could not link commits:', (error as Error).message); return 0 })
  return { ok: true, queued: await handleGithubPush(payload), linked }
})
