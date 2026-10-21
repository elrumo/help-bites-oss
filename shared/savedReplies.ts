// Saved replies: canned answers an operator inserts into the reply box. Shared
// by the API, the panel and (ported by hand, see tests/supportNativeParity.test.ts)
// the native app, so a placeholder fills the same way everywhere.

import { MESSAGE_BODY_MAX_LENGTH } from './support'

export const SAVED_REPLY_TITLE_MAX_LENGTH = 120
export const SAVED_REPLY_BODY_MAX_LENGTH = MESSAGE_BODY_MAX_LENGTH
export const SAVED_REPLY_SHORTCUT_MAX_LENGTH = 30
/** A project's library; plenty for a canned-answer list, and it keeps the picker's scan cheap. */
export const SAVED_REPLIES_PER_PROJECT = 200

export type SavedReply = {
  id: string
  projectId: string
  title: string
  body: string
  /** A short handle to find it by (`refund`); stored without a leading slash, lowercase. */
  shortcut: string
  createdAt: string | null
  updatedAt: string | null
}

export type SavedReplyValues = { title?: string, body?: string, shortcut?: string }

/** `/Refund ` and `refund` are the same shortcut: letters, digits, dash and underscore only. */
export function normalizeShortcut(value: unknown): string {
  return String(value ?? '').trim().replace(/^\/+/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SAVED_REPLY_SHORTCUT_MAX_LENGTH)
}

/** A create or edit body. Only the keys that are present are checked and returned. */
export function readSavedReplyInput(payload: unknown, options: { create: boolean }): { values: SavedReplyValues, errors: string[] } {
  const raw = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>
  const values: SavedReplyValues = {}
  const errors: string[] = []
  if (raw.title !== undefined || options.create) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!title) errors.push('A title is required')
    else if (title.length > SAVED_REPLY_TITLE_MAX_LENGTH) errors.push(`The title is longer than ${SAVED_REPLY_TITLE_MAX_LENGTH} characters`)
    else values.title = title
  }
  if (raw.body !== undefined || options.create) {
    const body = typeof raw.body === 'string' ? raw.body.trim() : ''
    if (!body) errors.push('The reply text is required')
    else if (body.length > SAVED_REPLY_BODY_MAX_LENGTH) errors.push(`The reply is longer than ${SAVED_REPLY_BODY_MAX_LENGTH} characters`)
    else values.body = body
  }
  if (raw.shortcut !== undefined) {
    if (raw.shortcut !== null && typeof raw.shortcut !== 'string') errors.push('shortcut must be text')
    else values.shortcut = normalizeShortcut(raw.shortcut)
  }
  return { values, errors }
}

export type ReplyPerson = { name?: string | null, email?: string | null }

/** What a customer is called in a greeting when they gave no name. */
export const REPLY_FALLBACK_NAME = 'there'

/** The first word of their name, else `there`: "Hi {{firstName}}," always reads. */
export function replyFirstName(person: ReplyPerson): string {
  return String(person.name ?? '').trim().split(/\s+/)[0] || REPLY_FALLBACK_NAME
}

export function replyFullName(person: ReplyPerson): string {
  return String(person.name ?? '').trim() || REPLY_FALLBACK_NAME
}

/**
 * Fill `{{firstName}}` and `{{name}}` from the customer. Spaces inside the
 * braces and letter case are ignored (`{{ FirstName }}`); anything else in
 * double braces is left as written, so a literal `{{code}}` in an answer
 * survives. The Swift port is SavedReplyFill in SavedReplies.swift.
 */
export function fillSavedReply(body: string, person: ReplyPerson): string {
  return String(body ?? '').replace(/\{\{\s*(firstName|name)\s*\}\}/gi, (_whole, key: string) => key.toLowerCase() === 'firstname' ? replyFirstName(person) : replyFullName(person))
}

export const SAVED_REPLY_PLACEHOLDERS = ['{{firstName}}', '{{name}}'] as const

function norm(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

/**
 * Replies matching `q`, best first: the shortcut itself, then a title that
 * starts with it, then a title or shortcut containing it, then the text.
 * An empty query returns the list by title. Ties keep the library's order.
 */
export function matchSavedReplies<T extends Pick<SavedReply, 'title' | 'body' | 'shortcut'>>(replies: readonly T[], q: string, limit = 20): T[] {
  const term = norm(q.trim().replace(/^\/+/, ''))
  if (!term) return [...replies].sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit)
  const scored: { reply: T, score: number, at: number }[] = []
  replies.forEach((reply, at) => {
    const title = norm(reply.title)
    const shortcut = norm(reply.shortcut)
    const score = shortcut === term ? 5 : title.startsWith(term) || (shortcut && shortcut.startsWith(term)) ? 4 : title.includes(term) || shortcut.includes(term) ? 3 : norm(reply.body).includes(term) ? 1 : 0
    if (score) scored.push({ reply, score, at })
  })
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).slice(0, limit).map(entry => entry.reply)
}
