import { bodyOf, headerMap } from '#shared/inboundEmail'

defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'mailgunInbound',
    summary: 'Mailgun inbound mail',
    description: 'Point a Mailgun Route here (`match_recipient(".*")` with `forward("<APP_URL>/v1/webhooks/mailgun-inbound")`) and mail sent to a project\'s inbound address becomes a conversation, or a reply in the one it continues. Signed with MAILGUN_WEBHOOK_SIGNING_KEY. Mail for an unknown address, automatic replies and mail over a limit are accepted and dropped, so nothing is bounced back. See docs/INBOUND-EMAIL.md.',
    responses: { 200: { description: '`{ ok: true, outcome }`: created, appended, duplicate or dropped (with a reason).' }, 401: { description: 'Bad or stale signature.' }, 406: { description: 'Not a Mailgun route post, or too large; Mailgun does not retry.' }, 503: { description: 'Not configured, or the replay check is unavailable; Mailgun retries.' } }
  }
})

const REPLAY_WINDOW_SECONDS = 24 * 60 * 60
const MAX_BYTES = 20 * 1024 * 1024

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** `Name <addr@host>` (or a bare address) as { email, name }. */
function mailbox(value: string): { email: string, name: string } {
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(value)
  return angled ? { name: angled[1]!.trim(), email: angled[2]!.trim() } : { name: '', email: value.trim() }
}

export default defineEventHandler(async (event) => {
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || ''
  if (!key) throw createError({ statusCode: 503, statusMessage: 'MAILGUN_WEBHOOK_SIGNING_KEY is not set' })
  if (Number(getHeader(event, 'content-length') || 0) > MAX_BYTES) throw createError({ statusCode: 406, statusMessage: 'Too large' })
  // Before the body is read: the signature is in it, so every post is parsed until it is checked.
  await rateLimit(`sb:rl:mgin:${clientIp(event) || 'ip'}`, 600, 60)

  const fields: Record<string, unknown> = {}
  const files: { data: Buffer, filename: string }[] = []
  if (String(getHeader(event, 'content-type') || '').startsWith('multipart/form-data')) {
    for (const part of await readMultipartFormData(event).catch(() => []) || []) {
      if (part.filename && part.name) files.push({ data: Buffer.from(part.data), filename: part.filename })
      else if (part.name) fields[part.name] = part.data.toString('utf8')
    }
  } else {
    Object.assign(fields, await readBody(event).catch(() => ({})))
  }
  const signature = { timestamp: text(fields.timestamp), token: text(fields.token), signature: text(fields.signature) }
  if (!signature.token || !text(fields.recipient)) throw createError({ statusCode: 406, statusMessage: 'Expected a Mailgun route post' })
  if (!verifyMailgunSignature(signature, key)) throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })

  // A signature covers timestamp and token only, so one that leaked could carry any mail: accept each token once.
  const age = Date.now() / 1000 - Number(signature.timestamp)
  if (!(age < REPLAY_WINDOW_SECONDS && age > -300)) throw createError({ statusCode: 401, statusMessage: 'Stale signature' })
  const seenKey = `sb:mgin:${signature.token.slice(0, 100)}`
  const fresh = await useRedis().set(seenKey, '1', 'EX', REPLAY_WINDOW_SECONDS, 'NX').catch(() => {
    throw createError({ statusCode: 503, statusMessage: 'Replay check unavailable; retry later' })
  })
  if (fresh !== 'OK') return { ok: true, outcome: 'duplicate' }

  const headers = headerMap(fields['message-headers'])
  const header = (name: string) => headers[name] || text(fields[name]) || text(fields[name.replace(/(^|-)([a-z])/g, (_m, dash, c) => dash + c.toUpperCase())])
  const from = mailbox(header('from') || text(fields.from) || text(fields.sender))
  try {
    const outcome = await ingestInboundMail({
      recipients: [text(fields.recipient), ...[header('to'), header('cc'), header('delivered-to'), header('x-original-to')].flatMap(v => v.split(','))].map(r => mailbox(r).email).filter(Boolean),
      from,
      subject: text(fields.subject) || header('subject'),
      body: bodyOf({ 'stripped-text': fields['stripped-text'], 'body-plain': fields['body-plain'] }),
      messageId: header('message-id'),
      inReplyTo: header('in-reply-to'),
      references: header('references'),
      headers,
      files
    })
    return { ok: true, ...outcome }
  } catch (error) {
    await useRedis().del(seenKey).catch(() => {})
    throw error
  }
})
