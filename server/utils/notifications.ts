import type { Message } from '#shared/support'

// Email is advisory: the row is already stored and visible in the recipient's
// inbox before any mail is attempted, so every failure here degrades to
// `{ sent: false, error }` rather than failing the write.
//
// One email per conversation per side per 5 minutes: a burst of short
// messages (the normal case in a chat) is one notification, not ten.

const THROTTLE_SECONDS = 5 * 60

type Result = { sent: boolean, error: string }

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

async function deliver(project: ParseObject, label: string, input: { to: string[], fromName: string, appName: string, senderName: string, recipientName: string, subject: string, body: string, ctaUrl: string, ctaLabel: string, attachmentUrls: string[], poweredBy?: PoweredBy | null, unmetered?: boolean }): Promise<Result> {
  if (!input.to.length) return { sent: false, error: 'No recipient' }
  const sender = projectEmailSender(project, { fromName: input.fromName })
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
      unmetered: input.unmetered,
      log: { source: 'notification', kind: 'message', templateName: label, batchId, actor: SYSTEM_EMAIL_ACTOR }
    })))
    const failed = results.filter(r => r.status === 'failed' || r.status === 'suppressed')
    if (failed.length === results.length) return { sent: false, error: failed[0]?.error || 'Not sent' }
    return { sent: true, error: '' }
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
    body: `From ${from}${opts.endUser.get('email') ? ` (${opts.endUser.get('email')})` : ''}\n\n${String(opts.message.get('body') || '')}`,
    ctaUrl: `${String(process.env.ADMIN_URL || process.env.APP_URL || '').replace(/\/+$/, '')}/inbox?c=${opts.conversation.id}`,
    ctaLabel: 'Open the inbox',
    attachmentUrls: attachmentUrls(opts.message),
    // Mail to the team about its own inbox is not counted against the plan; mail to end users is.
    unmetered: true
  })
}

/** The team replied: tell the user, if the host app gave us an email. */
export async function notifyUserOfAgentMessage(opts: { project: ParseObject, conversation: ParseObject, endUser: ParseObject, message: ParseObject }): Promise<Result> {
  const email = String(opts.endUser.get('email') || '').trim()
  if (!isProbablyEmail(email)) return { sent: false, error: 'User has no email' }
  if (await throttled(opts.conversation.id || '', 'user')) return { sent: false, error: 'throttled' }

  const appName = String(opts.project.get('name') || 'Support')
  const senderName = String(opts.message.get('senderName') || opts.project.get('fromName') || appName)
  const siteUrl = String(opts.project.get('siteUrl') || '').replace(/\/+$/, '')
  const inboxPath = String(opts.project.get('inboxPath') || '')
  const ctaUrl = siteUrl ? `${siteUrl}${inboxPath}${inboxPath.includes('?') ? '&' : '?'}sb=${opts.conversation.id}` : ''
  return deliver(opts.project, 'Conversation: reply', {
    to: [email],
    fromName: `${senderName} from ${appName}`,
    appName,
    senderName,
    recipientName: String(opts.endUser.get('name') || ''),
    subject: String(opts.conversation.get('subject') || ''),
    body: String(opts.message.get('body') || ''),
    ctaUrl,
    ctaLabel: 'Open your inbox',
    attachmentUrls: attachmentUrls(opts.message),
    poweredBy: await poweredByFor(opts.project)
  })
}

export type { Message }
