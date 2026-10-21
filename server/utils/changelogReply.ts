import { createHash } from 'node:crypto'
import { CHANGELOG_REPLY_LIST_MAX, CHANGELOG_REPLY_SEND_MAX, defaultReplyBody, mergeConversationIds, type ChangelogLinkedConversation, type ChangelogLinkedConversations, type ChangelogReplyInput, type ChangelogReplyResult } from '#shared/changelogReply'
import { changelogEntryUrl } from './changelog'
import type { ParseObject } from './parse'

// "Reply to the linked conversations": once an entry ships, an operator may
// tell the customers whose conversations it answers. The list is the entry's
// own conversation links plus those of its board items; replying goes through
// the same functions the inbox's reply route uses (an agent message, then the
// usual email), and only ever on an operator's explicit request.

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter(Boolean) : [])

/**
 * The customer conversations an entry's links reach, in this project only (an
 * id from another project is simply not found). Error issues are tracked as
 * conversations too, but there is no customer to tell, so they are left out.
 */
export async function linkedConversationRows(project: ParseObject, entry: ParseObject): Promise<ParseObject[]> {
  const Parse = useParse()
  const boardIds = stringList(entry.get('boardItemIds'))
  const items = boardIds.length
    ? await collectAll(() => new Parse.Query('BoardItem').equalTo('project', project).containedIn('objectId', boardIds), { max: boardIds.length, keys: ['conversationIds'] })
    : []
  const ids = mergeConversationIds(stringList(entry.get('conversationIds')), items.map(item => ({ conversationIds: stringList(item.get('conversationIds')) }))).slice(0, CHANGELOG_REPLY_LIST_MAX)
  if (!ids.length) return []
  const rows = await collectAll(() => new Parse.Query('Conversation').equalTo('project', project).containedIn('objectId', ids).include('endUser'), { max: ids.length })
  const byId = new Map(rows.map(row => [row.id || '', row]))
  return ids.flatMap((id) => { const row = byId.get(id); return row && row.get('type') !== 'error' ? [row] : [] })
}

function endUserNameOf(conversation: ParseObject): string {
  const endUser = conversation.get('endUser') as ParseObject | undefined
  return endUser && typeof endUser.get === 'function' ? String(endUser.get('name') || endUser.get('email') || endUser.get('externalId') || '') : ''
}

/** The entry's public address, when it has an absolute one. */
function publicEntryUrl(project: ParseObject, entry: ParseObject): string {
  const url = changelogEntryUrl(project, entry)
  return /^https?:\/\//.test(url) ? url : ''
}

export async function linkedConversationsOf(project: ParseObject, entry: ParseObject): Promise<ChangelogLinkedConversations> {
  const rows = await linkedConversationRows(project, entry)
  const conversations: ChangelogLinkedConversation[] = rows.map(row => ({ id: row.id || '', subject: String(row.get('subject') || ''), endUserName: endUserNameOf(row), status: String(row.get('status') || '') }))
  return { count: conversations.length, conversations, defaultBody: defaultReplyBody(String(entry.get('title') || ''), publicEntryUrl(project, entry)) }
}

/**
 * Append the operator's message to each chosen conversation (all linked ones
 * when none are named), as the inbox reply does, and email the customer unless
 * `notifyByEmail` is off. One failing never stops the rest. Sending the same
 * words to the same conversation twice is a no-op (`clientId` is derived from the
 * entry, the conversation and the text).
 */
export async function replyToLinkedConversations(project: ParseObject, agent: ParseObject, entry: ParseObject, input: ChangelogReplyInput): Promise<ChangelogReplyResult> {
  const linked = await linkedConversationRows(project, entry)
  const byId = new Map(linked.map(row => [row.id || '', row]))
  const wanted = input.conversationIds ?? linked.map(row => row.id || '')
  const digest = createHash('sha256').update(input.body).digest('hex').slice(0, 12)
  const result: ChangelogReplyResult = { sent: 0, failed: 0, results: [] }

  for (const id of wanted.slice(0, CHANGELOG_REPLY_SEND_MAX)) {
    const conversation = byId.get(id)
    if (!conversation) {
      result.failed++
      result.results.push({ conversationId: id, ok: false, emailSent: false, error: 'Not linked to this entry' })
      continue
    }
    try {
      const message = readMessageInput({ body: input.body, clientId: `clr-${entry.id}-${conversation.id}-${digest}` }, project.id || '')
      const { message: saved, created } = await appendMessage({ conversation, sender: 'agent', senderName: agentDisplayName(project, agent), agent, input: message })
      let emailSent = false
      let error = created ? '' : 'Already sent'
      if (created && input.notifyByEmail) {
        const endUser = conversation.get('endUser') as ParseObject | undefined
        const mail = endUser ? await notifyUserOfAgentMessage({ project, conversation, endUser, message: saved }) : { sent: false, error: 'No customer' }
        emailSent = mail.sent
        error = mail.sent ? '' : mail.error
      }
      result.sent++
      result.results.push({ conversationId: id, ok: true, emailSent, error })
    } catch (error) {
      result.failed++
      result.results.push({ conversationId: id, ok: false, emailSent: false, error: String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Could not send') })
    }
  }
  return result
}
