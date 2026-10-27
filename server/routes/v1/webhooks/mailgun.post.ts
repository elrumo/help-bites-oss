defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'mailgunWebhook',
    summary: 'Mailgun delivery events',
    description: 'Point Mailgun\'s webhooks (delivered, opened, clicked, permanent and temporary failure, spam complaint, unsubscribe) here. Signed with MAILGUN_WEBHOOK_SIGNING_KEY. Each event moves its email log entry on; a hard bounce, a complaint or an unsubscribe also puts the address on the project\'s suppression list.',
    responses: { 200: { description: 'Accepted (or not one of ours).' }, 401: { description: 'Bad signature.' }, 406: { description: 'Not a Mailgun JSON webhook; Mailgun does not retry.' }, 503: { description: 'Not configured, or the message\'s log entry is not saved yet; Mailgun retries.' } }
  }
})

const REPLAY_WINDOW_SECONDS = 24 * 60 * 60
const MAX_BYTES = 1024 * 1024

export default defineEventHandler(async (event) => {
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || ''
  if (!key) throw createError({ statusCode: 503, statusMessage: 'MAILGUN_WEBHOOK_SIGNING_KEY is not set' })
  // Anyone can post here: the signature is checked after the body is read, so the body is bounded first (an event is a few KB) and so is the rate.
  if (Number(getHeader(event, 'content-length') || 0) > MAX_BYTES) throw createError({ statusCode: 406, statusMessage: 'Too large' })
  await rateLimit(`sb:rl:mgwh:${clientIp(event) || 'ip'}`, 600, 60)
  const body = (await readBody(event).catch(() => null)) as { signature?: MailgunSignature, 'event-data'?: Record<string, unknown> } | null
  if (!body?.signature || !body['event-data']) throw createError({ statusCode: 406, statusMessage: 'Expected a Mailgun JSON webhook' })
  if (!verifyMailgunSignature(body.signature, key)) throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })

  // Mailgun signs timestamp + token, not the event, so one captured signature
  // could carry any event. A signature is accepted for a day (Mailgun retries
  // for up to 8 hours) and its token is remembered for that whole day: used
  // once, never again. Without Redis there is no memory, so ask for a retry.
  const age = Date.now() / 1000 - Number(body.signature.timestamp)
  if (!(age < REPLAY_WINDOW_SECONDS && age > -300)) throw createError({ statusCode: 401, statusMessage: 'Stale signature' })
  const seenKey = `sb:mgwh:${String(body.signature.token).slice(0, 100)}`
  const fresh = await useRedis().set(seenKey, '1', 'EX', REPLAY_WINDOW_SECONDS, 'NX').catch(() => {
    throw createError({ statusCode: 503, statusMessage: 'Replay check unavailable; retry later' })
  })
  if (fresh !== 'OK') return { ok: true, duplicate: true }

  const outcome = await applyMailgunEvent(body['event-data']).catch(async (error) => {
    await useRedis().del(seenKey).catch(() => {})
    throw error
  })
  if (outcome === 'retry') {
    await useRedis().del(seenKey).catch(() => {})
    throw createError({ statusCode: 503, statusMessage: 'The message is not logged yet; retry later' })
  }
  return { ok: true, outcome }
})
