// Email that arrives at a project's address becomes a conversation. The rules
// that decide what to do with one message live here, pure, so the webhook
// handler (server/routes/v1/webhooks/mailgun-inbound.post.ts) stays plumbing.

import { normalizeHost } from './domains'

/** `domain`: an address on a domain whose MX points at the mail provider. `forward`: a HelpBites address the project's own mailbox forwards to. */
export const INBOUND_KINDS = ['domain', 'forward'] as const
export type InboundKind = typeof INBOUND_KINDS[number]
export const INBOUND_STATES = ['pending', 'verified', 'failed'] as const
export type InboundState = typeof INBOUND_STATES[number]

export const INBOUND_ADDRESS_LIMIT = 5
/** Where a conversation's id rides in the address we send from: support+c_<id>@example.com. */
export const THREAD_TAG = 'c_'

export type InboundAddressDto = {
  id: string
  kind: InboundKind
  /** Where mail arrives: the address on your domain, or the HelpBites alias to forward to. */
  address: string
  /** What people reply to and see, when it differs from `address` (a forwarded support@yourdomain). */
  publicAddress: string
  fromName: string
  state: InboundState
  mxRecords: { type: 'MX', host: string, value: string, priority: number }[]
  verifiedAt: string | null
  lastCheckedAt: string | null
}

const LOCAL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** An address as stored: lower-case, a plain local part (no +tag), a public domain. Null otherwise. */
export function splitAddress(input: unknown): { local: string, domain: string, address: string } | null {
  const value = String(input || '').trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1')
  const at = value.lastIndexOf('@')
  if (at < 1) return null
  const local = value.slice(0, at).replace(/\+.*$/, '')
  const domain = normalizeHost(value.slice(at + 1))
  if (!domain || !LOCAL_RE.test(local)) return null
  return { local, domain, address: `${local}@${domain}` }
}

/** The address we send from and ask for replies at: `support@x.com` for conversation `abc` is `support+c_abc@x.com`. */
export function replyAddress(address: string, conversationId: string): string {
  const parts = splitAddress(address)
  return parts && /^[A-Za-z0-9]{1,40}$/.test(conversationId) ? `${parts.local}+${THREAD_TAG}${conversationId}@${parts.domain}` : address
}

/** A recipient as it arrived: the stored address plus the conversation id when the +tag names one. Case of the id is kept (Parse ids are case-sensitive). */
export function threadTag(recipient: string): { address: string, conversationId: string } | null {
  const parts = splitAddress(recipient)
  if (!parts) return null
  const raw = String(recipient || '').trim().replace(/^.*<([^>]+)>.*$/, '$1')
  const tag = new RegExp(`\\+${THREAD_TAG}([A-Za-z0-9]{1,40})@`).exec(raw)
  return { address: parts.address, conversationId: tag?.[1] || '' }
}

/** `<id@host>` from whatever a header held; '' when it is not one. */
export function normalizeMessageId(value: unknown): string {
  const match = /<([^<>\s]{1,300})>/.exec(String(value || ''))
  return match ? `<${match[1]}>` : ''
}

/** Every message id in an In-Reply-To or References header, newest reference first, at most 20. */
export function messageIds(...headers: unknown[]): string[] {
  const found = headers.flatMap(header => [...String(header || '').matchAll(/<[^<>\s]{1,300}>/g)].map(m => m[0]))
  return [...new Set(found.reverse())].slice(0, 20)
}

/** Header names are case-insensitive; Mailgun sends them as `message-headers`, a JSON list of [name, value]. */
export function headerMap(raw: unknown): Record<string, string> {
  let list: unknown = raw
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw) } catch { list = [] }
  }
  const out: Record<string, string> = {}
  for (const pair of Array.isArray(list) ? list : []) {
    if (Array.isArray(pair) && typeof pair[0] === 'string') out[pair[0].toLowerCase()] ||= String(pair[1] ?? '')
  }
  return out
}

/**
 * Mail no person wrote: delivery failures, out-of-office replies, mailing lists,
 * bulk mail. Answering them would start loops, so they are dropped without a conversation.
 */
export function isAutoReply(headers: Record<string, string>, sender: string): boolean {
  const from = String(sender || '').trim().toLowerCase()
  if (!from || from === '<>' || /^(mailer-daemon|postmaster)@/.test(from)) return true
  const auto = (headers['auto-submitted'] || '').trim().toLowerCase()
  if (auto && auto !== 'no') return true
  if (/^(bulk|junk|list|auto_reply)$/i.test((headers.precedence || '').trim())) return true
  if ('x-autoreply' in headers || 'x-autorespond' in headers || 'list-id' in headers || 'list-unsubscribe' in headers) return true
  return /\b(all|oof|autoreply)\b/i.test(headers['x-auto-response-suppress'] || '')
}

/** What was typed: the provider's text without the quoted reply, else the whole text. */
export function bodyOf(fields: { 'stripped-text'?: unknown, 'body-plain'?: unknown }): string {
  const stripped = String(fields['stripped-text'] || '').trim()
  return (stripped || String(fields['body-plain'] || '').trim()).replace(/\r\n/g, '\n')
}

/** The subject without the Re:/Fwd: prefixes a thread collects. */
export function cleanSubject(subject: unknown): string {
  return String(subject || '').replace(/^(\s*(re|fwd?|aw|sv|vs|tr)\s*:\s*)+/i, '').trim().slice(0, 200)
}

/** Whether DNS MX hosts route to the mail provider (Mailgun, US or EU). */
export function mxPointsAtProvider(hosts: string[]): boolean {
  return hosts.some(host => /(^|\.)mailgun\.org\.?$/i.test(host.trim()))
}

/** The MX records to show for a `domain` address: Mailgun's receiving hosts for the region the server uses. */
export function providerMxRecords(domain: string, apiBaseUrl: string): InboundAddressDto['mxRecords'] {
  const eu = /\.eu\./i.test(apiBaseUrl)
  const host = (letter: string) => `mx${letter}.${eu ? 'eu.' : ''}mailgun.org`
  return [10, 10].map((priority, i) => ({ type: 'MX' as const, host: domain, value: host(i ? 'b' : 'a'), priority }))
}
