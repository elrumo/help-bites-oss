import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { readLinkToken, signLinkToken } from './secrets'
import type { FeedbackContext } from './feedback'

// A planning attachment too big for a tool call goes up as raw bytes: the caller asks for a ticket (an operator,
// an API key or a verified end user, like any upload), then PUTs the file to the ticket's URL with `curl -T`. The URL
// is the credential for that one project, owner and filename for a quarter of an hour, so no base64 and no
// Authorization header. ponytail: a ticket is not single-use (that needs a store); the upload rate limit and the
// workspace's storage cap bound a leaked one. Upgrade: record the ticket's nonce in Redis and burn it on use.

const TTL_MS = 15 * 60 * 1000

export type UploadTicket = { projectId: string, owner: string, filename: string }

/** Who an upload is stored under, and the checks that come with being that actor. */
export function uploadOwnerOf(ctx: FeedbackContext): string {
  if (ctx.actor.kind === 'agent') return `agent-${ctx.actor.agent.id}`
  if (ctx.actor.kind === 'user') {
    // Anyone can mint an email-only session, and uploads cost storage: they wait for a verified address.
    requireVerifiedAnonymous(ctx.actor.claims)
    if (ctx.project.get('allowAttachments') === false) throw createError({ statusCode: 403, statusMessage: 'Attachments are off for this project' })
    // The host's user id can hold any character; keys get a hash of it.
    return `u-${createHash('sha1').update(ctx.actor.externalId).digest('hex').slice(0, 16)}`
  }
  return ''
}

export function mintUploadTicket(ticket: UploadTicket, now = Date.now()): { token: string, expiresAt: Date } {
  const exp = now + TTL_MS
  return { token: signLinkToken('upload-ticket', JSON.stringify({ p: ticket.projectId, o: ticket.owner, f: ticket.filename, exp })), expiresAt: new Date(exp) }
}

export function readUploadTicket(token: string, now = Date.now()): UploadTicket | null {
  try {
    const parsed = JSON.parse(readLinkToken('upload-ticket', token) || '')
    if (parsed.p && typeof parsed.f === 'string' && parsed.f && parsed.exp > now) return { projectId: String(parsed.p), owner: String(parsed.o || ''), filename: parsed.f }
  } catch { /* falls through */ }
  return null
}
