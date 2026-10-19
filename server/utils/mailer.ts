// The one place that talks to Mailgun. Every project shares the API key; a
// project may send from its own address and Mailgun domain (Project → Dev →
// Email sending), otherwise the MAILGUN_* defaults apply. Callers that want a
// record of what went out use deliverEmail (emailDelivery.ts), which logs
// every message; this file only speaks the provider's protocol.

export type MailAttachment = {
  filename: string
  contentType: string
  data: Uint8Array
  /** Referenced from the HTML as `cid:<filename>` instead of listed as an attachment. */
  inline?: boolean
}

export type SendMailInput = {
  /** Addresses, bare or `Name <addr>`. One message, every recipient visible to the others. */
  to: string[]
  fromName: string
  /** Sender address; MAILGUN_FROM_EMAIL when blank. */
  fromEmail?: string
  /** Mailgun sending domain; MAILGUN_DOMAIN when blank. */
  domain?: string
  replyTo?: string
  cc?: string[]
  bcc?: string[]
  subject: string
  html: string
  text: string
  /** Extra MIME headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>
  tags?: string[]
  /** Mailgun user variables (`v:`): echoed back in delivery webhooks. */
  variables?: Record<string, string>
  attachments?: MailAttachment[]
  /** Accepted now, delivered at this time (Mailgun holds it up to three days). */
  deliverAt?: Date | null
  /** Mailgun accepts and logs the message but never delivers it. */
  testMode?: boolean
  tracking?: { opens?: boolean, clicks?: boolean }
}

export type SendMailResult = {
  /** Mailgun's message id, without the angle brackets; webhooks name the message by it. */
  id: string
}

export function mailgunDefaults(): { domain: string, fromEmail: string, baseUrl: string } {
  return {
    domain: (process.env.MAILGUN_DOMAIN || '').trim(),
    fromEmail: (process.env.MAILGUN_FROM_EMAIL || '').trim(),
    baseUrl: (process.env.MAILGUN_API_BASE_URL || 'https://api.eu.mailgun.net').replace(/\/+$/, '')
  }
}

/** Can mail go out, from this sender (a project's own address and domain) or the defaults? */
export function isMailerConfigured(sender: { fromEmail?: string, domain?: string } = {}): boolean {
  const defaults = mailgunDefaults()
  return Boolean(process.env.MAILGUN_API_KEY && (sender.domain || defaults.domain) && (sender.fromEmail || defaults.fromEmail))
}

/** `Name <addr>`, quoting a name that carries characters an address list treats as syntax. */
export function formatMailbox(name: string, email: string): string {
  const clean = String(name || '').replace(/[\r\n<>"\\]/g, '').trim()
  if (!clean) return email
  return /[,;:@()[\].]/.test(clean) ? `"${clean}" <${email}>` : `${clean} <${email}>`
}

/** Throws on a missing key or a Mailgun rejection; callers decide whether that is fatal. */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const defaults = mailgunDefaults()
  const domain = (input.domain || defaults.domain).trim()
  const fromEmail = (input.fromEmail || defaults.fromEmail).trim()
  if (!isMailerConfigured({ domain, fromEmail })) throw new Error('Mailgun is not configured')
  if (!input.to.length) throw new Error('No recipients')

  const fields: [string, string][] = [
    ['from', formatMailbox(input.fromName || 'Support', fromEmail)],
    ['to', input.to.join(', ')],
    ['subject', input.subject],
    ['html', input.html],
    ['text', input.text]
  ]
  if (input.cc?.length) fields.push(['cc', input.cc.join(', ')])
  if (input.bcc?.length) fields.push(['bcc', input.bcc.join(', ')])
  if (input.replyTo) fields.push(['h:Reply-To', input.replyTo])
  for (const [name, value] of Object.entries(input.headers || {})) fields.push([`h:${name}`, value])
  for (const tag of input.tags || []) fields.push(['o:tag', tag])
  for (const [name, value] of Object.entries(input.variables || {})) fields.push([`v:${name}`, value])
  if (input.deliverAt) fields.push(['o:deliverytime', input.deliverAt.toUTCString()])
  if (input.testMode) fields.push(['o:testmode', 'yes'])
  if (input.tracking?.opens !== undefined) fields.push(['o:tracking-opens', input.tracking.opens ? 'yes' : 'no'])
  if (input.tracking?.clicks !== undefined) fields.push(['o:tracking-clicks', input.tracking.clicks ? 'yes' : 'no'])

  // Files need multipart; everything else stays a plain form, as before.
  let body: URLSearchParams | FormData
  if (input.attachments?.length) {
    const form = new FormData()
    for (const [name, value] of fields) form.append(name, value)
    for (const file of input.attachments) {
      form.append(file.inline ? 'inline' : 'attachment', new Blob([file.data as BlobPart], { type: file.contentType }), file.filename)
    }
    body = form
  } else {
    body = new URLSearchParams(fields)
  }

  const response = await fetch(`${defaults.baseUrl}/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}` },
    body,
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Mailgun ${response.status}: ${detail.slice(0, 300)}`)
  }
  const result = await response.json().catch(() => ({})) as { id?: string }
  return { id: String(result.id || '').replace(/^<|>$/g, '') }
}
