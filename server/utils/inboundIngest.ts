import { createHash } from 'node:crypto'
import { normalizeEmail } from '#shared/contacts'
import { isAutoReply, messageIds, normalizeMessageId, threadTag } from '#shared/inboundEmail'
import { MAX_ATTACHMENTS_PER_MESSAGE, MESSAGE_BODY_MAX_LENGTH, clampText, type Attachment } from '#shared/support'
import { MASTER, pointerId, useParse, type ParseObject } from './parse'
import { ensureEndUser } from './auth'
import { maybeAutoRespond } from './autoResponder'
import { appendEvent, appendMessage, createConversation } from './conversations'
import { findInboundAddress } from './inboundEmail'
import { endUserDisplayName } from './names'
import { notifyAgentsOfUserMessage } from './notifications'
import { LIMITS, rateLimit } from './rateLimit'
import { runExclusive } from './redis'
import { storeAttachment } from './s3'
import { hasFeature, projectWorkspaceId } from './usage'

export type InboundMail = {
  /** Every address the mail was addressed to: the envelope recipient first, then To, Cc, Delivered-To. */
  recipients: string[]
  from: { email: string, name: string }
  subject: string
  body: string
  messageId: string
  inReplyTo: string
  references: string
  headers: Record<string, string>
  files: { data: Buffer, filename: string }[]
}

export type InboundOutcome =
  | { outcome: 'created' | 'appended', conversationId: string, messageId: string }
  | { outcome: 'duplicate' | 'dropped', reason: string }

const dropped = (reason: string): InboundOutcome => ({ outcome: 'dropped', reason })
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

/** The conversation this mail continues: by the ids it replies to, else by the tag in the address. Only the person who is in it can continue it. */
async function findThread(project: ParseObject, endUser: ParseObject, mail: InboundMail, tagged: string): Promise<ParseObject | null> {
  const Parse = useParse()
  const ids = messageIds(mail.inReplyTo, mail.references)
  const mine = (conversation: ParseObject | null | undefined) => conversation && pointerId(conversation.get('endUser')) === endUser.id && pointerId(conversation.get('project')) === project.id ? conversation : null
  if (ids.length) {
    const hit = await new Parse.Query('Message').equalTo('project', project).containedIn('emailMessageId', ids).include('conversation').first(MASTER)
    const found = mine(hit?.get('conversation') as ParseObject | undefined)
    if (found) return found
  }
  if (tagged) return mine(await new Parse.Query('Conversation').equalTo('project', project).equalTo('objectId', tagged).first(MASTER))
  return null
}

async function storeFiles(project: ParseObject, endUser: ParseObject, files: InboundMail['files']): Promise<{ attachments: Attachment[], skipped: string[] }> {
  const attachments: Attachment[] = []
  const skipped: string[] = []
  const workspaceId = await projectWorkspaceId(project)
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) { skipped.push(file.filename); continue }
    try {
      attachments.push(await storeAttachment(file.data, project.id || '', `email-${endUser.id}`, workspaceId))
    } catch {
      // Not an image HelpBites keeps (or storage is full): the message still lands, saying what was left out.
      skipped.push(file.filename)
    }
  }
  return { attachments, skipped }
}

/**
 * One received email, made into a message: a new conversation, or a reply in the one it continues.
 * Never throws for mail it does not want (unknown address, auto-reply, over a limit): those are
 * dropped quietly, because answering them would be backscatter. A real failure (the database)
 * does throw, so the provider retries.
 */
export async function ingestInboundMail(mail: InboundMail): Promise<InboundOutcome> {
  // The address mail was delivered to may be a forwarding alias with no tag, while the To header a mailbox forwarded still carries the one we sent from: look at all of them.
  const tags = mail.recipients.map(threadTag)
  const tagged = tags.find(parts => parts?.conversationId)?.conversationId || ''
  let row: ParseObject | null = null
  for (const parts of tags) {
    if (parts && (row = await findInboundAddress(parts.address))) break
  }
  const project = row?.get('project') as ParseObject | undefined
  if (!row || !project?.id) return dropped('unknown address')
  const workspaceId = await projectWorkspaceId(project)
  if (!(await hasFeature(workspaceId, 'inboundEmail'))) return dropped('plan')

  const sender = normalizeEmail(mail.from.email)
  const own = [String(row.get('address')), String(row.get('publicAddress') || ''), String(project.get('fromEmail') || '')].map(normalizeEmail)
  if (!sender || own.includes(sender)) return dropped('from our own address')
  if (isAutoReply(mail.headers, sender)) return dropped('automatic reply')
  try {
    await rateLimit(`sb:rl:inbound:s:${project.id}:${sha(sender)}`, LIMITS.inboundPerSender.limit, LIMITS.inboundPerSender.window)
    await rateLimit(`sb:rl:inbound:p:${project.id}`, LIMITS.inboundPerProject.limit, LIMITS.inboundPerProject.window)
  } catch {
    return dropped('rate limit')
  }

  const messageId = normalizeMessageId(mail.messageId)
  const clientId = `em-${sha(messageId || `${sender}|${mail.subject}|${mail.body}`).slice(0, 32)}`
  const Parse = useParse()
  const locked = await runExclusive(`sb:inbound:${clientId}`, 60, async (): Promise<InboundOutcome> => {
    if (await new Parse.Query('Message').equalTo('project', project).equalTo('clientId', clientId).first(MASTER)) return { outcome: 'duplicate', reason: 'already received' }

    // From is a header anyone can write: the mail makes a contact, never an identity. An address already on file is that contact.
    const existing = await new Parse.Query('EndUser').equalTo('project', project).equalTo('email', sender).descending('updatedAt').first(MASTER)
    const endUser = existing || await ensureEndUser(project, { sub: `email:${sender}`, name: mail.from.name, email: sender }, { touch: false })
    const name = endUserDisplayName(endUser, { name: mail.from.name })

    const { attachments, skipped } = await storeFiles(project, endUser, mail.files)
    const note = skipped.length ? `\n\n[Not shown: ${skipped.slice(0, 5).join(', ')}]` : ''
    const body = clampText(`${mail.body}${note}`, MESSAGE_BODY_MAX_LENGTH)
    if (!body && !attachments.length) return dropped('empty')

    let conversation = await findThread(project, endUser, mail, tagged)
    const isNew = !conversation
    if (!conversation) {
      try {
        conversation = await createConversation(project, endUser, clampText(mail.subject, 200) || 'Email', null)
      } catch (error) {
        // The plan's conversations are used up: the mail is not kept (a 402 is the only refusal createConversation makes).
        if ((error as { statusCode?: number }).statusCode === 402) return dropped('plan limit')
        throw error
      }
      conversation.set('channel', 'email')
      await conversation.save(null, MASTER)
      await appendEvent(conversation, { type: 'created', byName: name })
    }
    const { message, created } = await appendMessage({ conversation, sender: 'user', senderName: name, input: { body, replyToId: '', clientId, attachments, context: null, emailMessageId: messageId } })
    if (created) {
      await notifyAgentsOfUserMessage({ project, conversation, endUser, message })
      maybeAutoRespond(conversation, message)
    }
    return { outcome: isNew ? 'created' : 'appended', conversationId: conversation.id || '', messageId: message.id || '' }
  }, { waitMs: 5000 })
  if (!locked.ran) throw new Error('inbound mail is being processed; retry')
  return locked.value
}
