import { MESSAGE_BODY_MAX_LENGTH, clampText } from './support'

// "Reply to the linked conversations": after an entry ships, the operator can
// tell the people whose conversations it answers. The conversations come from
// the entry's own links and from its board items'; nothing is ever sent unless
// the operator presses send. Shared by the API, the panel and the tests.

/** Conversations listed for one entry. */
export const CHANGELOG_REPLY_LIST_MAX = 200
/** Conversations one send reaches. */
export const CHANGELOG_REPLY_SEND_MAX = 100

export type ChangelogLinkedConversation = { id: string, subject: string, endUserName: string, status: string }

export type ChangelogLinkedConversations = {
  count: number
  conversations: ChangelogLinkedConversation[]
  /** The message the dialog starts with: the entry's title and its public address. Editable. */
  defaultBody: string
}

export type ChangelogReplyResult = {
  sent: number
  failed: number
  /** One row per conversation tried. `emailSent` is false when the person has no email or was mailed recently. */
  results: { conversationId: string, ok: boolean, emailSent: boolean, error: string }[]
}

/** The starting text of the reply. `url` is left out when the entry has no public address. */
export function defaultReplyBody(title: string, url: string): string {
  const name = title.trim() || 'your request'
  return `Good news: “${name}” has just shipped.${url ? `\n\nSee what changed: ${url}` : ''}`
}

/** The ids an entry's conversations come from: its own, then its board items', once each. */
export function mergeConversationIds(own: string[], items: { conversationIds: string[] }[]): string[] {
  return [...new Set([...own, ...items.flatMap(item => item.conversationIds)].filter(Boolean))]
}

export type ChangelogReplyInput = { body: string, conversationIds: string[] | null, notifyByEmail: boolean }

/** The body of POST …/reply-conversations. `conversationIds` null means every linked conversation. */
export function readChangelogReplyInput(payload: unknown): { value: ChangelogReplyInput, errors: string[] } {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const errors: string[] = []
  const body = clampText(raw.body, MESSAGE_BODY_MAX_LENGTH)
  if (!body) errors.push('A message is required')
  let conversationIds: string[] | null = null
  if (raw.conversationIds !== undefined && raw.conversationIds !== null) {
    if (!Array.isArray(raw.conversationIds)) errors.push('conversationIds must be an array')
    else {
      conversationIds = [...new Set(raw.conversationIds.map(id => String(id ?? '').trim()).filter(Boolean))]
      if (conversationIds.length > CHANGELOG_REPLY_SEND_MAX) errors.push(`At most ${CHANGELOG_REPLY_SEND_MAX} conversations per send`)
    }
  }
  if (raw.notifyByEmail !== undefined && typeof raw.notifyByEmail !== 'boolean') errors.push('notifyByEmail must be true or false')
  return { value: { body, conversationIds, notifyByEmail: raw.notifyByEmail !== false }, errors }
}
