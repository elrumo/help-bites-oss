import type { Message } from '#shared/support'
import { emailReplyContext, threadHeaders } from './inboundEmail'
import { MASTER } from './parse'

// Email is advisory: the row is already stored and visible in the recipient's
// inbox before any mail is attempted, so every failure here degrades to
// `{ sent: false, error }` rather than failing the write.
//
// One email per conversation per side per 5 minutes: a burst of short
// messages (the normal case in a chat) is one notification, not ten.

const THROTTLE_SECONDS = 5 * 60

type Result = { sent: boolean, error: string, messageId?: string }

async function throttled(conversationId: string, side: 'user' | 'agent'): Promise<boolean> {
  try {
    const ok = await useRedis().set(`sb:emailed:${conversationId}:${side}`, '1', 'EX', THROTTLE_SECONDS, 'NX')
    return ok !== 'OK'
  } catch {
    return false
  }
}

function attachmentUrls(message: ParseObject): string[] {
  const list = message.get('attachments')
  return Array.isArray(list) ? list.map((a: { url?: string }) => String(a?.url || '')).filter(Boolean) : []
}

async function deliver(project: ParseObject, label: string, input: { to: string[], fromName: string, appName: string, senderName: string, recipientName: string, subject: string, body: string, ctaUrl: string, ctaLabel: string, attachmentUrls: string[], poweredBy?: PoweredBy | null, unmetered?: boolean, replyTo?: string, fromEmail?: string, headers?: Record<string, string> }): Promise<Result> {
  if (!input.to.length) return { sent: false, error: 'No recipient' }
  // A conversation that came in by email is answered from its address; a project whose sending domain does not cover that address keeps its own sender, and Reply-To still brings the answer back.
  const sender = (() => {
    try { return projectEmailSender(project, { fromName: input.fromName, fromEmail: input.fromEmail, replyTo: input.replyTo }) } catch { return projectEmailSender(project, { fromName: input.fromName, replyTo: input.replyTo }) }
  })()
  if (!isMailerConfigured(sender)) return { sent: false, error: 'Mailgun is not configured' }
  try {
    const { subject, html, text } = renderMessageEmail(input)
    const batchId = newEmailBatchId()
    // One message per address, each logged; the team's addresses stay out of each other's headers.
    const results = await deliverEmails(input.to.map(email => ({
      project,
      to: { email, name: input.recipientName },
      subject,
      html,
      text,
      sender,
      headers: input.headers,
      unmetered: input.unmetered,
      log: { source: 'notification', kind: 'message', templateName: label, batchId, actor: SYSTEM_EMAIL_ACTOR }
    })))
    const failed = results.filter(r => r.status === 'failed' || r.status === 'suppressed')
    if (failed.length === results.length) return { sent: false, error: failed[0]?.error || 'Not sent' }
    return { sent: true, error: '', messageId: results.find(r => r.messageId)?.messageId }
  } catch (error) {
    console.error('[notifications] send failed:', (error as Error).message)
    return { sent: false, error: (error as Error).message }
  }
}

/** A user wrote: tell the project's notify addresses. */
export async function notifyAgentsOfUserMessage(opts: { project: ParseObject, conversation: ParseObject, endUser: ParseObject, message: ParseObject }): Promise<Result> {
  const to = parseRecipientList(opts.project.get('notifyEmails'))
  if (!to.length) return { sent: false, error: 'No notify emails on the project' }
  if (await throttled(opts.conversation.id || '', 'agent')) return { sent: false, error: 'throttled' }

  const appName = String(opts.project.get('name') || 'Support')
  const from = endUserDisplayName(opts.endUser)
  const subject = opts.conversation.get('subject') ? `${from}: ${opts.conversation.get('subject')}` : `New message from ${from}`
  return deliver(opts.project, 'Conversation: new message (team)', {
    to,
    fromName: `${appName} support`,
    appName,
    senderName: from,
    recipientName: '',
    subject,
    body: `From ${from}${opts.endUser.get('email') || opts.endUser.get('pendingEmail') ? ` (${opts.endUser.get('email') || opts.endUser.get('pendingEmail')})` : ''}\n\n${String(opts.message.get('body') || '')}`,
    ctaUrl: `${String(process.env.ADMIN_URL || process.env.APP_URL || '').replace(/\/+$/, '')}/inbox?c=${opts.conversation.id}`,
    ctaLabel: 'Open the inbox',
    attachmentUrls: attachmentUrls(opts.message),
    // Mail to the team about its own inbox is not counted against the plan; mail to end users is.
    unmetered: true
  })
}

/**
 * The team replied: tell the user, if the host app gave us an email, or an email-only user typed one they have
 * not confirmed yet (a person wrote this reply after reading what they sent; nothing automatic mails that address). A conversation that came in by email
 * is a mail thread: every reply is mailed (no five-minute batching), as a reply to the thread, and
 * answers to it come back to the project's address.
 */
export async function notifyUserOfAgentMessage(opts: { project: ParseObject, conversation: ParseObject, endUser: ParseObject, message: ParseObject }): Promise<Result> {
  const email = String(opts.endUser.get('email') || opts.endUser.get('pendingEmail') || '').trim()
  if (!isProbablyEmail(email)) return { sent: false, error: 'User has no email' }
  const viaEmail = opts.conversation.get('channel') === 'email'
  if (!viaEmail && await throttled(opts.conversation.id || '', 'user')) return { sent: false, error: 'throttled' }

  const appName = String(opts.project.get('name') || 'Support')
  const senderName = String(opts.message.get('senderName') || opts.project.get('fromName') || appName)
  const siteUrl = String(opts.project.get('siteUrl') || '').replace(/\/+$/, '')
  const inboxPath = String(opts.project.get('inboxPath') || '')
  const ctaUrl = !viaEmail && siteUrl ? `${siteUrl}${inboxPath}${inboxPath.includes('?') ? '&' : '?'}sb=${opts.conversation.id}` : ''
  const thread = viaEmail ? await emailReplyContext(opts.project, opts.conversation) : null
  const subject = String(opts.conversation.get('subject') || '')
  const result = await deliver(opts.project, 'Conversation: reply', {
    to: [email],
    fromName: thread?.fromName || `${senderName} from ${appName}`,
    appName,
    senderName,
    recipientName: String(opts.endUser.get('name') || ''),
    subject: viaEmail && subject && !/^re:/i.test(subject) ? `Re: ${subject}` : subject,
    body: String(opts.message.get('body') || ''),
    ctaUrl,
    ctaLabel: 'Open your inbox',
    attachmentUrls: attachmentUrls(opts.message),
    poweredBy: await poweredByFor(opts.project),
    replyTo: thread?.replyTo,
    fromEmail: thread?.fromEmail,
    headers: viaEmail ? await threadHeaders(opts.conversation) : undefined
  })
  // The Message-ID we sent under is how the customer's answer finds this thread again.
  if (viaEmail && result.messageId) {
    opts.message.set('emailMessageId', result.messageId)
    await opts.message.save(null, MASTER).catch(() => {})
  }
  return result
}

/** Error alert rules fired: one mail to the team listing what crossed its lines. */
export async function notifyErrorAlerts(project: ParseObject, to: string[], lines: string[]): Promise<Result> {
  const appName = String(project.get('name') || 'Support')
  const first = lines[0]!.split('\n')[0]
  return deliver(project, 'Error alert', {
    to,
    fromName: `${appName} errors`,
    appName,
    senderName: 'Error tracker',
    recipientName: '',
    subject: lines.length === 1 ? `Error alert: ${first}` : `${lines.length} error alerts for ${appName}`,
    body: lines.join('\n\n'),
    ctaUrl: `${String(process.env.ADMIN_URL || process.env.APP_URL || '').replace(/\/+$/, '')}/projects/${project.id}/errors`,
    ctaLabel: 'Open errors',
    attachmentUrls: [],
    unmetered: true
  })
}

export type { Message }
