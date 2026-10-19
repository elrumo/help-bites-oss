import { randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { edition } from './edition'
import { formatMailbox, mailgunDefaults, sendMail, type MailAttachment } from './mailer'
import { isProbablyEmail } from './projects'

// Every email HelpBites sends goes through deliverEmail: the send API, test
// sends, conversation notifications, feedback emails, operator password
// resets. It skips addresses the project no longer mails, hands the message
// to Mailgun, and writes one EmailLog row per recipient either way, so the
// log is the complete history of what went out, what was refused and why.
//
// One message per recipient, always: recipients never see each other, each
// can get their own variables, and each has its own delivery status.

export type EmailSource = 'api' | 'admin' | 'test' | 'notification' | 'feedback' | 'system' | 'campaign' | 'sequence'
export type EmailKind = 'template' | 'html' | 'document' | 'message'
export type EmailActor = { type: 'project' | 'agent' | 'admin_key' | 'system', id: string, name: string }
export type EmailRecipient = { email: string, name: string }
export type EmailSender = { fromName: string, fromEmail: string, domain: string, replyTo: string }
export type DeliveryStatus = 'sent' | 'scheduled' | 'failed' | 'suppressed'

export type EmailLogContext = {
  source: EmailSource
  kind: EmailKind
  template?: ParseObject | null
  templateKey?: string
  templateName?: string
  /** What the message was rendered with; sensitive values are redacted before they are stored. */
  variables?: Record<string, string>
  batchId: string
  idempotencyKey?: string
  actor: EmailActor
  ip?: string
  userAgent?: string
}

export type OutgoingEmail = {
  project: ParseObject | null
  /** Mail a workspace sends without a project (a master template's test): its log belongs to the workspace. */
  workspace?: ParseObject | null
  to: EmailRecipient
  cc?: string[]
  bcc?: string[]
  subject: string
  html: string
  text: string
  sender: EmailSender
  headers?: Record<string, string>
  tags?: string[]
  /** The caller's own keys: stored on the log and echoed back by delivery webhooks. */
  metadata?: Record<string, string>
  attachments?: MailAttachment[]
  deliverAt?: Date | null
  testMode?: boolean
  tracking?: { opens?: boolean, clicks?: boolean }
  /** Send even to an address on the project's suppression list. */
  ignoreSuppressions?: boolean
  /** Not counted against the workspace's email allowance: mail to its own team. */
  unmetered?: boolean
  log: EmailLogContext
}

export type DeliveryResult = { to: string, status: DeliveryStatus, logId: string, messageId: string, error: string }

const MAX_LOGGED_HTML = 300 * 1024
const MAX_LOGGED_TEXT = 100 * 1024
const MAX_LOGGED_VALUE = 300
const SEND_CONCURRENCY = 8

/** A short id for one API call; every recipient's log row carries it. */
export function newEmailBatchId(): string {
  return `eb_${randomBytes(9).toString('base64url')}`
}

export function emailDomainOf(address: string): string {
  return String(address || '').split('@').pop()!.trim().toLowerCase()
}

/**
 * Who a project's mail comes from. A call may change the name and the
 * reply-to freely; a different address must stay on the project's own
 * sending domain, so a project secret can never send as someone else.
 */
export function projectEmailSender(project: ParseObject | null, override: { fromName?: string, fromEmail?: string, replyTo?: string } = {}): EmailSender {
  const defaults = mailgunDefaults()
  const projectFrom = String(project?.get('fromEmail') || '').trim()
  const domain = String(project?.get('mailDomain') || '').trim() || defaults.domain
  const fromEmail = projectFrom || defaults.fromEmail
  const sender: EmailSender = {
    fromName: String(project?.get('fromName') || project?.get('name') || '').trim() || 'Support',
    fromEmail,
    domain,
    replyTo: String(project?.get('replyTo') || '').trim()
  }
  if (override.fromName?.trim()) sender.fromName = override.fromName.trim().slice(0, 120)
  if (override.replyTo?.trim()) sender.replyTo = override.replyTo.trim()
  const wanted = override.fromEmail?.trim()
  if (wanted && wanted.toLowerCase() !== fromEmail.toLowerCase()) {
    const allowed = new Set([emailDomainOf(fromEmail), domain.toLowerCase()].filter(Boolean))
    if (!isProbablyEmail(wanted) || !allowed.has(emailDomainOf(wanted))) {
      throw createError({ statusCode: 400, statusMessage: `"from" must be an address on ${[...allowed].join(' or ') || 'the project\'s sending domain'}` })
    }
    sender.fromEmail = wanted
  }
  const rewrite = edition().rewriteSender
  return rewrite ? rewrite(sender, project) : sender
}

// Values that unlock something (reset and verification links, codes, tokens)
// never reach the log; the key stays, so the log still shows what was passed.
const SENSITIVE_KEY_RE = /pass|secret|token|otp|code|key|auth|sig|link|url|href|reset|verif|confirm|invite|unsubscribe/i

export function redactEmailVariables(vars: Record<string, string> | undefined): { key: string, value: string }[] {
  return Object.entries(vars || {}).slice(0, 100).map(([key, raw]) => {
    if (SENSITIVE_KEY_RE.test(key)) return { key, value: '[redacted]' }
    const value = String(raw ?? '')
    return { key, value: value.length > MAX_LOGGED_VALUE ? `${value.slice(0, MAX_LOGGED_VALUE)}…` : value }
  })
}

async function writeEmailLog(mail: OutgoingEmail, outcome: { status: DeliveryStatus, messageId: string, error: string, durationMs: number }): Promise<string> {
  const Parse = useParse()
  const row = new (Parse.Object.extend('EmailLog'))()
  const { log } = mail
  if (mail.project) row.set('project', mail.project)
  else if (mail.workspace) row.set('workspace', mail.workspace)
  if (log.template) row.set('template', log.template)
  row.set('templateKey', log.templateKey || '')
  row.set('templateName', log.templateName || '')
  row.set('batchId', log.batchId)
  row.set('source', log.source)
  row.set('kind', log.kind)
  row.set('to', mail.to.email.toLowerCase())
  row.set('toName', mail.to.name || '')
  row.set('cc', mail.cc || [])
  row.set('bcc', mail.bcc || [])
  row.set('from', formatMailbox(mail.sender.fromName, mail.sender.fromEmail))
  row.set('replyTo', mail.sender.replyTo || '')
  row.set('subject', mail.subject.slice(0, 500))
  row.set('status', outcome.status)
  row.set('error', outcome.error.slice(0, 1000))
  row.set('messageId', outcome.messageId)
  row.set('tags', mail.tags || [])
  row.set('metadata', mail.metadata || {})
  row.set('variables', redactEmailVariables(log.variables))
  row.set('attachments', (mail.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, size: a.data.byteLength, inline: Boolean(a.inline) })))
  row.set('headerNames', Object.keys(mail.headers || {}))
  row.set('events', [])
  if (mail.deliverAt) row.set('scheduledAt', mail.deliverAt)
  row.set('testMode', Boolean(mail.testMode))
  if (log.idempotencyKey) row.set('idempotencyKey', log.idempotencyKey)
  row.set('actorType', log.actor.type)
  row.set('actorId', log.actor.id)
  row.set('actorName', log.actor.name)
  row.set('ip', log.ip || '')
  row.set('userAgent', (log.userAgent || '').slice(0, 300))
  row.set('durationMs', outcome.durationMs)
  // The message itself only when the project asked for it: it can carry links that unlock accounts.
  const keepContent = mail.project?.get('emailLogContent') === true && outcome.status !== 'suppressed'
  row.set('hasContent', keepContent)
  if (keepContent) {
    row.set('html', mail.html.slice(0, MAX_LOGGED_HTML))
    row.set('text', mail.text.slice(0, MAX_LOGGED_TEXT))
  }
  await row.save(null, MASTER)
  return row.id || ''
}

/** Send one message and log it. Never throws for a provider failure: the result says what happened. */
export async function deliverEmail(mail: OutgoingEmail, options: { suppressed?: Map<string, string> } = {}): Promise<DeliveryResult> {
  const started = Date.now()
  const email = mail.to.email.toLowerCase()
  let outcome: { status: DeliveryStatus, messageId: string, error: string }

  const reason = mail.ignoreSuppressions ? undefined : options.suppressed?.get(email)
  if (reason) {
    outcome = { status: 'suppressed', messageId: '', error: `On the suppression list (${reason})` }
  } else {
    try {
      const { id } = await sendMail({
        to: [formatMailbox(mail.to.name, mail.to.email)],
        fromName: mail.sender.fromName,
        fromEmail: mail.sender.fromEmail,
        domain: mail.sender.domain,
        replyTo: mail.sender.replyTo,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: mail.headers,
        tags: mail.tags,
        variables: { ...mail.metadata, hb_batch: mail.log.batchId, ...(mail.project?.id ? { hb_project: mail.project.id } : {}) },
        attachments: mail.attachments,
        deliverAt: mail.deliverAt,
        testMode: mail.testMode,
        tracking: mail.tracking
      })
      outcome = { status: mail.deliverAt ? 'scheduled' : 'sent', messageId: id, error: '' }
    } catch (error) {
      outcome = { status: 'failed', messageId: '', error: (error as Error).message || 'Send failed' }
      console.warn(`[email] send to ${email} failed:`, outcome.error)
    }
  }

  let logId = ''
  try {
    logId = await writeEmailLog(mail, { ...outcome, durationMs: Date.now() - started })
  } catch (error) {
    // The mail already went (or did not); a lost log row must not turn that into an error.
    console.error('[email] could not write the log:', (error as Error).message)
  }
  return { to: email, ...outcome, logId }
}

// HelpBites' own mail (resets, invitations) and mail to the team are not counted against the plan.
const isMetered = (mail: OutgoingEmail) => !mail.unmetered && mail.log.source !== 'system'

/**
 * Deliver a batch a few at a time, after one suppression lookup for all of it.
 * Counted mail is reserved against the month's and the day's allowance before
 * anything goes (402 when either would run out), and what then fails or is
 * suppressed is given back.
 */
export async function deliverEmails(mails: OutgoingEmail[]): Promise<DeliveryResult[]> {
  const project = mails[0]?.project || null
  const metered = mails.filter(isMetered).length
  const workspaceId = metered ? (project ? await projectWorkspaceId(project) : mails[0]?.workspace?.id || '') : ''
  if (metered) {
    // Only counted mail waits for a confirmed owner: the confirmation mail itself is the platform's own.
    await assertWorkspaceVerified(workspaceId)
    await reserveUsage(workspaceId, 'emails', metered)
    try {
      await reserveUsage(workspaceId, 'emailsPerDay', metered)
    } catch (error) {
      await chargeUsage(workspaceId, 'emails', -metered)
      throw error
    }
  }
  const suppressed = project && mails.some(m => !m.ignoreSuppressions)
    ? await suppressedEmails(project, mails.map(m => m.to.email)).catch((error) => {
      console.error('[email] suppression lookup failed:', (error as Error).message)
      return new Map<string, string>()
    })
    : new Map<string, string>()
  const results: DeliveryResult[] = new Array(mails.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, mails.length) }, async () => {
    while (next < mails.length) {
      const i = next++
      results[i] = await deliverEmail(mails[i]!, { suppressed })
    }
  }))
  const unsent = results.filter((result, i) => isMetered(mails[i]!) && (result.status === 'failed' || result.status === 'suppressed')).length
  if (unsent) await Promise.all([chargeUsage(workspaceId, 'emails', -unsent), chargeUsage(workspaceId, 'emailsPerDay', -unsent)])
  return results
}

export type DeliverySummary = {
  /** The batch id: every recipient's log entry carries it. */
  id: string
  sent: number
  failed: string[]
  suppressed: string[]
  results: { to: string, status: DeliveryStatus, logId: string, messageId: string, error?: string }[]
}

export function summarizeDeliveries(batchId: string, results: DeliveryResult[]): DeliverySummary {
  return {
    id: batchId,
    sent: results.filter(r => r.status === 'sent' || r.status === 'scheduled').length,
    failed: results.filter(r => r.status === 'failed').map(r => r.to),
    suppressed: results.filter(r => r.status === 'suppressed').map(r => r.to),
    results: results.map(r => ({ to: r.to, status: r.status, logId: r.logId, messageId: r.messageId, ...(r.error ? { error: r.error } : {}) }))
  }
}

/** The system actor for mail HelpBites sends on its own (notifications, resets). */
export const SYSTEM_EMAIL_ACTOR: EmailActor = { type: 'system', id: '', name: 'HelpBites' }
