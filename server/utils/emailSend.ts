import { createHash } from 'node:crypto'
import { createError, getHeader, getQuery, readBody, readMultipartFormData, type H3Event } from 'h3'
import type { EmailDocument } from '#shared/email/blocks'
import { can, type Action } from '#shared/roles'
import { normalizeDocument } from '#shared/email/ops'
import { escapeHtmlValue, fillPlaceholders } from '#shared/email/placeholders'
import { renderEmailHtml } from '#shared/email/render'
import { decodeHtmlEntities, htmlToText, plainTextFor, projectBrandVars, resolveTemplate } from '#shared/email/resolve'
import { withPoweredByHtml, withPoweredByText, type PoweredBy } from './branding'
import { brandOf, cleanVariableValues, renderEmailTemplate, serializeEmailTemplate, validateDocument } from './emails'
import { formatMailbox, type MailAttachment } from './mailer'
import { renderMessageEmail } from './messageEmail'
import { isProbablyEmail } from './projects'
import type { EmailActor, EmailKind, EmailRecipient, EmailSender, EmailSource, OutgoingEmail } from './emailDelivery'

// The send API's request: read (JSON, or multipart with an HTML file and
// attachments), checked, and turned into one message per recipient. The
// render endpoint reads the same request and stops before sending, so a
// preview is exactly what a send would deliver.
//
// Content is exactly one of:
//   template   a send key or id of one of the project's templates
//   html       raw HTML (or an uploaded .html file); {{key}} escaped, {{{key}}} raw
//   document   a block document, like the ones the editor exports
//   message    { subject, body, ctaUrl?, ctaLabel? }: plain text in the project's message layout

export const EMAIL_SEND_LIMITS = {
  recipients: 50,
  copies: 10,
  attachments: 10,
  attachmentBytes: 10 * 1024 * 1024,
  htmlBytes: 2 * 1024 * 1024,
  requestBytes: 16 * 1024 * 1024,
  headers: 20,
  tags: 3,
  // Mailgun caps a message's custom variables at a few KB.
  metadataKeys: 10,
  metadataValueLength: 200,
  scheduleHours: 72,
  variableLength: 100_000
} as const

export type SendRecipient = EmailRecipient & { variables: Record<string, string> }

export type EmailContent =
  | { type: 'template', ref: string }
  | { type: 'html', html: string }
  | { type: 'document', document: unknown }
  | { type: 'message', subject: string, body: string, ctaUrl: string, ctaLabel: string }

export type EmailSendRequest = {
  content: EmailContent
  recipients: SendRecipient[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  variables: Record<string, string>
  from: { name?: string, email?: string }
  replyTo: string
  headers: Record<string, string>
  tags: string[]
  metadata: Record<string, string>
  attachments: MailAttachment[]
  sendAt: Date | null
  testMode: boolean
  tracking?: { opens?: boolean, clicks?: boolean }
  ignoreSuppressions: boolean
  idempotencyKey: string
  /** Operators and admin keys name the project they send for. */
  project: string
}

function bad(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

// ---- addresses -----------------------------------------------------------------

/** `ada@example.com` or `Ada Lovelace <ada@example.com>`. */
export function parseMailbox(value: unknown): { email: string, name: string } | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const angled = raw.match(/^(.*)<([^<>]+)>\s*$/)
  const email = (angled ? angled[2]! : raw).trim()
  const name = angled ? angled[1]!.trim().replace(/^"(.*)"$/, '$1').trim() : ''
  return isProbablyEmail(email) ? { email, name: name.slice(0, 120) } : null
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

/**
 * `to` as one address, a list, or objects `{ email, name?, variables? }` for
 * per-recipient values. Duplicates (by address, any case) are sent once.
 */
export function parseEmailRecipients(value: unknown, max: number = EMAIL_SEND_LIMITS.recipients): SendRecipient[] {
  const out: SendRecipient[] = []
  const seen = new Set<string>()
  for (const entry of asList(value)) {
    let recipient: SendRecipient | null = null
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>
      const box = parseMailbox(obj.email)
      if (!box) bad(`"${String(obj.email ?? '').slice(0, 100)}" is not an email address`)
      recipient = { email: box.email, name: String(obj.name ?? box.name ?? '').trim().slice(0, 120), variables: cleanVariableValues(obj.variables, EMAIL_SEND_LIMITS.variableLength) }
    } else {
      const box = parseMailbox(entry)
      if (!box) bad(`"${String(entry ?? '').slice(0, 100)}" is not an email address`)
      recipient = { ...box, variables: {} }
    }
    const key = recipient.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(recipient)
  }
  if (!out.length) bad('Pass at least one recipient in "to"')
  if (out.length > max) bad(`At most ${max} recipients per request`)
  return out
}

/** cc / bcc: plain or named addresses, each copied onto every message. */
export function parseAddressList(value: unknown, field: string, max: number = EMAIL_SEND_LIMITS.copies): string[] {
  const list = asList(typeof value === 'string' ? value.split(',') : value).map(v => String(v ?? '').trim()).filter(Boolean)
  if (list.length > max) bad(`At most ${max} addresses in "${field}"`)
  return list.map((entry) => {
    const box = parseMailbox(entry)
    if (!box) bad(`"${entry.slice(0, 100)}" in "${field}" is not an email address`)
    return formatMailbox(box.name, box.email)
  })
}

function parseFrom(body: Record<string, unknown>): { name?: string, email?: string } {
  const from = body.from
  if (from && typeof from === 'object' && !Array.isArray(from)) {
    const obj = from as Record<string, unknown>
    const email = String(obj.email ?? '').trim()
    if (email && !isProbablyEmail(email)) bad('"from.email" is not an email address')
    return { name: String(obj.name ?? body.fromName ?? '').trim() || undefined, email: email || undefined }
  }
  if (typeof from === 'string' && from.trim()) {
    const box = parseMailbox(from)
    // A bare name is a name, not a broken address.
    if (!box) return { name: from.trim() }
    return { name: box.name || String(body.fromName ?? '').trim() || undefined, email: box.email }
  }
  return { name: String(body.fromName ?? '').trim() || undefined }
}

// ---- headers, tags, metadata ---------------------------------------------------------

// Set by HelpBites or the provider; changing them would break threading,
// tracking or authentication. Reply-To has its own field.
const RESERVED_HEADERS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'reply-to', 'sender', 'return-path', 'date', 'message-id', 'mime-version', 'content-type', 'content-transfer-encoding', 'dkim-signature', 'received'])

/** Extra headers. Values may use {{placeholders}}, filled per recipient (a List-Unsubscribe link per subscriber). */
export function parseEmailHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value !== 'object' || Array.isArray(value)) bad('"headers" must be an object of header name → value')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > EMAIL_SEND_LIMITS.headers) bad(`At most ${EMAIL_SEND_LIMITS.headers} headers`)
  const out: Record<string, string> = {}
  for (const [name, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name)) bad(`"${name.slice(0, 64)}" is not a valid header name`)
    if (RESERVED_HEADERS.has(name.toLowerCase()) || /^x-mailgun-/i.test(name)) bad(`The "${name}" header is set by HelpBites${name.toLowerCase() === 'reply-to' ? '; use "replyTo"' : ''}`)
    const text = String(raw ?? '')
    if (/[\r\n]/.test(text)) bad(`The "${name}" header may not contain line breaks`)
    if (text.length > 998) bad(`The "${name}" header is too long`)
    out[name] = text
  }
  return out
}

/** Up to three tags, for filtering in Mailgun and in the log. */
export function parseEmailTags(value: unknown): string[] {
  const tags = asList(typeof value === 'string' ? value.split(',') : value).map(v => String(v ?? '').trim()).filter(Boolean)
  if (tags.length > EMAIL_SEND_LIMITS.tags) bad(`At most ${EMAIL_SEND_LIMITS.tags} tags`)
  for (const tag of tags) if (!/^[\x20-\x7E]{1,128}$/.test(tag)) bad(`Tag "${tag.slice(0, 40)}" must be up to 128 printable ASCII characters`)
  return [...new Set(tags)]
}

/** Your own ids (a user id, an order number): stored on the log and echoed back by delivery webhooks. */
export function parseEmailMetadata(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value !== 'object' || Array.isArray(value)) bad('"metadata" must be an object')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > EMAIL_SEND_LIMITS.metadataKeys) bad(`At most ${EMAIL_SEND_LIMITS.metadataKeys} metadata keys`)
  const out: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(key) || key.startsWith('hb_')) bad(`Metadata key "${key.slice(0, 40)}" must be letters, digits, - or _ (and not start with hb_)`)
    if (raw !== null && typeof raw === 'object') bad(`Metadata "${key}" must be a string, number or boolean`)
    out[key] = String(raw ?? '').slice(0, EMAIL_SEND_LIMITS.metadataValueLength)
  }
  return out
}

/** When to deliver: an ISO date or Unix seconds, at most three days ahead. Past or now means now. */
export function parseSendAt(value: unknown, now = Date.now()): Date | null {
  if (value === undefined || value === null || value === '') return null
  const date = typeof value === 'number' || /^\d+$/.test(String(value)) ? new Date(Number(value) * 1000) : new Date(String(value))
  if (Number.isNaN(date.getTime())) bad('"sendAt" must be an ISO date or Unix seconds')
  if (date.getTime() <= now + 30_000) return null
  if (date.getTime() > now + EMAIL_SEND_LIMITS.scheduleHours * 60 * 60 * 1000) bad(`"sendAt" can be at most ${EMAIL_SEND_LIMITS.scheduleHours} hours ahead`)
  return date
}

// ---- attachments -------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', ics: 'text/calendar', zip: 'application/zip'
}

export function safeAttachmentName(value: unknown): string {
  const name = String(value ?? '').split(/[\\/]/).pop()!.replace(/[\x00-\x1F\x7F"]/g, '').trim().slice(0, 150)
  return name || 'attachment'
}

function mimeFor(filename: string, given: unknown): string {
  const type = String(given ?? '').trim().toLowerCase()
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(type)) return type
  return MIME_BY_EXT[filename.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream'
}

/** JSON attachments: `[{ filename, content (base64), contentType?, inline? }]`. */
export function parseJsonAttachments(value: unknown): MailAttachment[] {
  return asList(value).map((entry, i) => {
    if (!entry || typeof entry !== 'object') bad(`attachments[${i}] must be { filename, content }`)
    const obj = entry as Record<string, unknown>
    const content = String(obj.content ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
    if (!content || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) bad(`attachments[${i}].content must be base64`)
    const filename = safeAttachmentName(obj.filename)
    return { filename, contentType: mimeFor(filename, obj.contentType), data: new Uint8Array(Buffer.from(content, 'base64')), inline: obj.inline === true }
  })
}

export function checkAttachments(files: MailAttachment[]): MailAttachment[] {
  if (files.length > EMAIL_SEND_LIMITS.attachments) bad(`At most ${EMAIL_SEND_LIMITS.attachments} attachments`)
  const total = files.reduce((sum, f) => sum + f.data.byteLength, 0)
  if (total > EMAIL_SEND_LIMITS.attachmentBytes) throw createError({ statusCode: 413, statusMessage: `Attachments may total at most ${EMAIL_SEND_LIMITS.attachmentBytes / 1024 / 1024} MB` })
  return files
}

// ---- reading the request -------------------------------------------------------------

const JSON_FIELDS = new Set(['to', 'cc', 'bcc', 'variables', 'headers', 'metadata', 'tags', 'tracking', 'message', 'document', 'from', 'attachments'])
const LIST_FIELDS = new Set(['to', 'cc', 'bcc', 'tags'])

function tryJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * JSON, or multipart/form-data: a file part `html` (or `file`) is the email,
 * `attachment` / `inline` parts are attached, a `payload` part may carry the
 * JSON body, and plain fields fill in the rest (`to` may repeat).
 */
export async function readEmailSendBody(event: H3Event): Promise<{ body: Record<string, unknown>, files: MailAttachment[] }> {
  if (Number(getHeader(event, 'content-length') || 0) > EMAIL_SEND_LIMITS.requestBytes) throw createError({ statusCode: 413, statusMessage: 'Request too large' })
  if (!/multipart\/form-data/i.test(getHeader(event, 'content-type') || '')) {
    const body = await readBody(event).catch(() => null)
    return { body: body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}, files: [] }
  }
  const parts = await readMultipartFormData(event) || []
  let payload: Record<string, unknown> = {}
  const fields: Record<string, unknown> = {}
  const files: MailAttachment[] = []
  for (const part of parts) {
    const name = String(part.name || '').replace(/\[\]$/, '')
    if (part.filename !== undefined) {
      if (name === 'html' || name === 'file') {
        if (part.data.byteLength > EMAIL_SEND_LIMITS.htmlBytes) throw createError({ statusCode: 413, statusMessage: 'The HTML file is too large' })
        fields.html = part.data.toString('utf8')
      } else if (name === 'attachment' || name === 'attachments' || name === 'inline') {
        const filename = safeAttachmentName(part.filename)
        files.push({ filename, contentType: mimeFor(filename, part.type), data: new Uint8Array(part.data), inline: name === 'inline' })
      } else {
        bad(`Unexpected file field "${name}": send the email as "html" and attachments as "attachment"`)
      }
      continue
    }
    const value = part.data.toString('utf8')
    if (name === 'payload') {
      const parsed = tryJson(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) bad('"payload" must be a JSON object')
      payload = parsed as Record<string, unknown>
      continue
    }
    const parsed = JSON_FIELDS.has(name) && /^\s*[[{"]/.test(value) ? tryJson(value) : value
    fields[name] = LIST_FIELDS.has(name) && name in fields ? [...asList(fields[name]), ...asList(parsed)] : parsed
  }
  return { body: { ...payload, ...fields }, files }
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1
}

/** Check the whole request before anything is looked up or sent. */
export function parseEmailSendRequest(body: Record<string, unknown>, files: MailAttachment[], event?: H3Event): EmailSendRequest {
  const given = ['template', 'html', 'document', 'message'].filter(k => body[k] !== undefined && body[k] !== null && body[k] !== '')
  if (given.length !== 1) bad(given.length ? `Pass one of template, html, document or message, not ${given.join(' and ')}` : 'Pass the email as "template" (a send key or id), "html", "document" or "message"')

  let content: EmailContent
  if (body.template !== undefined && body.template !== null && body.template !== '') {
    content = { type: 'template', ref: String(body.template).trim() }
  } else if (body.html !== undefined && body.html !== null && body.html !== '') {
    const html = String(body.html)
    if (Buffer.byteLength(html) > EMAIL_SEND_LIMITS.htmlBytes) throw createError({ statusCode: 413, statusMessage: 'The HTML is too large' })
    content = { type: 'html', html }
  } else if (body.document !== undefined && body.document !== null && body.document !== '') {
    content = { type: 'document', document: body.document }
  } else {
    const message = body.message as Record<string, unknown>
    if (!message || typeof message !== 'object' || !String(message.body ?? '').trim()) bad('"message" needs a body: { subject, body, ctaUrl?, ctaLabel? }')
    content = { type: 'message', subject: String(message.subject ?? body.subject ?? '').trim(), body: String(message.body), ctaUrl: String(message.ctaUrl ?? '').trim(), ctaLabel: String(message.ctaLabel ?? '').trim() }
  }

  const replyToBox = body.replyTo ? parseMailbox(body.replyTo) : null
  if (body.replyTo && !replyToBox) bad('"replyTo" is not an email address')
  const idempotencyKey = String((event && getHeader(event, 'idempotency-key')) || body.idempotencyKey || '').trim()
  if (idempotencyKey && !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey)) bad('The idempotency key must be 1-128 printable characters without spaces')
  const tracking = body.tracking && typeof body.tracking === 'object'
    ? Object.fromEntries(Object.entries(body.tracking as Record<string, unknown>).filter(([k]) => k === 'opens' || k === 'clicks').map(([k, v]) => [k, flag(v)]))
    : undefined

  return {
    content,
    recipients: parseEmailRecipients(body.to),
    cc: parseAddressList(body.cc, 'cc'),
    bcc: parseAddressList(body.bcc, 'bcc'),
    subject: String(body.subject ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300),
    text: typeof body.text === 'string' ? body.text : '',
    variables: cleanVariableValues(body.variables, EMAIL_SEND_LIMITS.variableLength),
    from: parseFrom(body),
    replyTo: replyToBox ? formatMailbox(replyToBox.name, replyToBox.email) : '',
    headers: parseEmailHeaders(body.headers),
    tags: parseEmailTags(body.tags),
    metadata: parseEmailMetadata(body.metadata),
    attachments: checkAttachments([...parseJsonAttachments(body.attachments), ...files]),
    sendAt: parseSendAt(body.sendAt),
    testMode: flag(body.testMode),
    ...(tracking && Object.keys(tracking).length ? { tracking } : {}),
    ignoreSuppressions: flag(body.ignoreSuppressions),
    idempotencyKey,
    project: String(body.project ?? '').trim()
  }
}

// ---- who is calling --------------------------------------------------------------

export type EmailCaller = { project: ParseObject | null, member: MemberContext | null, actor: EmailActor, source: EmailSource }

/**
 * Who is calling, before the body is read. The project secret acts for its
 * own project; an operator session or admin key acts for whichever project
 * of its workspace it names (see callerProject), and its sends are logged as
 * the operator's.
 */
export async function authenticateEmailCaller(event: H3Event): Promise<EmailCaller> {
  if (optionalBearer(event).startsWith('sk_')) {
    const project = await requireProjectSecret(event)
    return { project, member: null, actor: { type: 'project', id: project.id || '', name: String(project.get('name') || '') }, source: 'api' }
  }
  const member = await requireMember(event)
  const name = String(member.agent.get('name') || member.agent.get('username') || '')
  return { project: null, member, actor: { type: member.sessionToken.startsWith('ak_') ? 'admin_key' : 'agent', id: member.agentId, name }, source: 'admin' }
}

/**
 * The caller's project: the secret's own, or the one an operator names (body
 * `project` or `?project=`) from their workspace. `can` is the role an
 * operator needs for this route (the secret is the host's server: it may).
 */
export async function callerProject(event: H3Event, caller: EmailCaller, ref?: unknown, options: { can?: Action } = {}): Promise<ParseObject> {
  if (caller.project && !caller.member) return caller.project
  const member = caller.member!
  if (options.can && !can(member.role, options.can)) throw createError({ statusCode: 403, statusMessage: 'Your role in this workspace cannot do that', data: { code: 'forbidden_role' } })
  if (caller.project) return caller.project
  const id = String(ref || getQuery(event).project || '').trim()
  if (!id) bad('Pass "project": the id of the project to act for')
  caller.project = await requireProject(member, id)
  return caller.project
}

// ---- composing ---------------------------------------------------------------------

export type ResolvedContent =
  | { type: 'template', row: ParseObject }
  | { type: 'html', html: string }
  | { type: 'document', document: EmailDocument }
  | { type: 'message', subject: string, body: string, ctaUrl: string, ctaLabel: string }

/** Look up what needs looking up (the template), once for the whole batch. */
export async function resolveEmailContent(project: ParseObject, content: EmailContent): Promise<ResolvedContent> {
  if (content.type === 'template') return { type: 'template', row: await findProjectEmail(project, content.ref) }
  // A caller's document is untrusted: filled out and cleaned up like the AI's, so it always renders.
  if (content.type === 'document') return { type: 'document', document: normalizeDocument(validateDocument(content.document)) }
  return content
}

/** A fragment becomes a document (so the charset is declared); a full document is sent as written. */
function wrapHtml(html: string, subject: string): string {
  if (/<html[\s>]/i.test(html)) return html
  const body = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '').trim()
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtmlValue(subject)}</title>\n</head>\n<body style="margin:0;padding:0;">\n${body}\n</body>\n</html>`
}

export type ComposedEmail = { subject: string, html: string, text: string, headers: Record<string, string>, variables: Record<string, string>, kind: EmailKind, template: { row: ParseObject, key: string, name: string } | null }

/** One recipient's message, exactly as it will be sent. `poweredBy` (poweredByFor) adds the "Powered by HelpBites" line. */
export function composeEmail(project: ParseObject, content: ResolvedContent, request: EmailSendRequest, recipient: SendRecipient, sender: EmailSender, poweredBy: PoweredBy | null = null): ComposedEmail {
  const values: Record<string, string> = { ...request.variables, ...recipient.variables, 'recipient.email': recipient.email, 'recipient.name': recipient.name }
  const brand = brandOf(project)
  const withBrand = { ...projectBrandVars(brand), ...values }
  const subjectOverride = request.subject ? fillPlaceholders(request.subject, withBrand) : ''
  const ownText = request.text.trim() ? fillPlaceholders(request.text, withBrand).trim() : ''
  const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, fillPlaceholders(value, withBrand).replace(/[\r\n]+/g, ' ')]))
  let subject: string
  let html: string
  let text: string
  let template: ComposedEmail['template'] = null

  if (content.type === 'template') {
    const rendered = renderEmailTemplate(content.row, project, values)
    const t = serializeEmailTemplate(content.row)
    template = { row: content.row, key: t.key, name: t.master?.name || t.name }
    subject = subjectOverride || rendered.subject
    html = rendered.html
    text = ownText || rendered.text
  } else if (content.type === 'document') {
    const { subject: own, document } = resolveTemplate({ name: '', document: content.document, variables: [] }, { brand, values })
    subject = subjectOverride || own
    html = renderEmailHtml(document)
    text = ownText || plainTextFor(document, html)
  } else if (content.type === 'html') {
    const filled = fillPlaceholders(content.html, withBrand, { html: true })
    subject = subjectOverride || decodeHtmlEntities(filled.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '')
    html = wrapHtml(filled, subject)
    text = ownText || htmlToText(html)
  } else {
    const fill = (value: string) => fillPlaceholders(value, withBrand)
    const rendered = renderMessageEmail({
      appName: brand.name || 'Support',
      senderName: sender.fromName,
      recipientName: recipient.name,
      subject: fill(content.subject) || subjectOverride,
      body: fill(content.body),
      ctaUrl: fill(content.ctaUrl),
      ctaLabel: fill(content.ctaLabel),
      attachmentUrls: [],
      poweredBy
    })
    subject = rendered.subject
    html = rendered.html
    text = ownText ? withPoweredByText(ownText, poweredBy) : rendered.text
  }
  // The message layout has its own place for the badge; everything else gets it at the end.
  if (content.type !== 'message') {
    html = withPoweredByHtml(html, poweredBy)
    text = withPoweredByText(text, poweredBy)
  }
  subject = subject.replace(/[\r\n]+/g, ' ').trim()
  if (!subject) bad(content.type === 'html' ? 'Pass a "subject" (or give the HTML a <title>)' : 'This email has no subject: set one on the template or pass "subject"')
  const kind: EmailKind = content.type
  return { subject, html, text, headers, variables: values, kind, template }
}

/** Every recipient's message for a send request. */
export function buildOutgoingEmails(project: ParseObject, actor: EmailActor, request: EmailSendRequest, content: ResolvedContent, sender: EmailSender, context: { batchId: string, source: EmailSource, event?: H3Event, poweredBy?: PoweredBy | null }): OutgoingEmail[] {
  const ip = context.event ? clientIp(context.event) || '' : ''
  const userAgent = context.event ? getHeader(context.event, 'user-agent') || '' : ''
  return request.recipients.map((recipient) => {
    const composed = composeEmail(project, content, request, recipient, sender, context.poweredBy)
    return {
      project,
      to: { email: recipient.email, name: recipient.name },
      cc: request.cc,
      bcc: request.bcc,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      sender,
      headers: composed.headers,
      tags: request.tags,
      metadata: request.metadata,
      attachments: request.attachments,
      deliverAt: request.sendAt,
      testMode: request.testMode,
      tracking: request.tracking,
      ignoreSuppressions: request.ignoreSuppressions,
      log: {
        source: context.source,
        kind: composed.kind,
        template: composed.template?.row || null,
        templateKey: composed.template?.key || '',
        templateName: composed.template?.name || '',
        variables: Object.fromEntries(Object.entries(composed.variables).filter(([k]) => !k.startsWith('recipient.'))),
        batchId: context.batchId,
        idempotencyKey: request.idempotencyKey,
        actor,
        ip,
        userAgent
      }
    }
  })
}

// ---- idempotency --------------------------------------------------------------------

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
// A crash between claiming a key and answering frees it again after this.
const IDEMPOTENCY_PENDING_SECONDS = 5 * 60

export type IdempotencyClaim = { replay: Record<string, unknown> | null, store: (response: Record<string, unknown>) => Promise<void>, release: () => Promise<void> }

/**
 * A retried request with the same key gets the first response back instead
 * of a second send. Keys live 24 hours, per project. Without Redis the call
 * simply goes through, like the rate limiter.
 */
export async function claimIdempotencyKey(projectId: string, key: string): Promise<IdempotencyClaim> {
  const noop: IdempotencyClaim = { replay: null, store: async () => {}, release: async () => {} }
  if (!key) return noop
  const redisKey = `sb:emailidem:${projectId}:${createHash('sha256').update(key).digest('hex')}`
  try {
    const redis = useRedis()
    const claimed = await redis.set(redisKey, '{"pending":true}', 'EX', IDEMPOTENCY_PENDING_SECONDS, 'NX')
    if (claimed !== 'OK') {
      const stored = JSON.parse(await redis.get(redisKey) || '{}') as Record<string, unknown>
      if (stored.pending) throw createError({ statusCode: 409, statusMessage: 'A request with this idempotency key is still being processed' })
      return { ...noop, replay: stored }
    }
    return {
      replay: null,
      store: async (response) => { await redis.set(redisKey, JSON.stringify(response), 'EX', IDEMPOTENCY_TTL_SECONDS).catch(() => {}) },
      release: async () => { await redis.del(redisKey).catch(() => {}) }
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    console.warn('[email] idempotency unavailable, sending anyway:', (error as Error).message)
    return noop
  }
}
