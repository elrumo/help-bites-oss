import { createHash } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { GUEST_SESSION_IDLE_DAYS, GUEST_WRITES_PER_10_MIN, GUEST_WRITES_PER_DAY, GUEST_WRITES_PER_PROJECT_HOUR, normalizeGuestSurfaces, type GuestSurface } from '#shared/guest'
import { poweredByFor } from './branding'
import { deliverEmails, newEmailBatchId, projectEmailSender, SYSTEM_EMAIL_ACTOR } from './emailDelivery'
import { CODE_TTL_MS, checkVerifyCode, guestDisplayName, hashEndUserToken, hashVerifyCode, isEndUserToken, needsVerification, newAnonExternalId, newEndUserToken, newGuestExternalId, newVerifyCode } from './endUserTokens'
import type { IdentityClaims } from './jwt'
import { renderMessageEmail } from './messageEmail'
import { MASTER, useParse, type ParseObject } from './parse'
import { findProjectByPublicKey } from './projects'
import { clientIp, LIMITS, rateLimit } from './rateLimit'
import { runExclusive } from './redis'

// Email-only users. When a project allows them (Project.allowAnonymousUsers),
// an app that has no backend to sign identity tokens can still use chat and
// feedback: it sends an address, gets an opaque `eu_…` session token and keeps
// it. The token resolves to the same principal a host-signed token would
// (sub = the row's externalId), so every route downstream is unchanged.
//
// Trust: an address is a claim until a mailed code proves it. Until then the
// address lives in `pendingEmail`, the token's claims carry no email (so flags,
// changelog subscriptions and reply mail ignore it), and after a few writes the
// person must verify. An address that is already known never gets a token from
// the session call alone: it gets a code, so nobody can pick up someone else's
// history by typing their address.
//
// Guests are the step below: no address at all (Project.guestSurfaces lists what
// they may use). Nothing proves who a guest is, so their session is the whole
// identity: it expires when unused, cannot upload, never gets an email on its
// claims (so no reply mail, flag allow-lists or subscriptions), is only allowed
// on the surfaces the admin opened, and is held to tighter write limits.

export const anonymousEnabled = (project: ParseObject): boolean => project.get('allowAnonymousUsers') === true

/** What the admin let guests into; empty means guests are off. */
export const guestSurfacesOf = (project: ParseObject): GuestSurface[] => normalizeGuestSurfaces(project.get('guestSurfaces'))

const addressKey = (email: string) => createHash('sha256').update(email).digest('hex')

const verifyRequired = () => createError({ statusCode: 403, statusMessage: 'Verify your email address to keep going', data: { code: 'email_verification_required' } })
const wrongCode = () => createError({ statusCode: 400, statusMessage: 'That code is wrong or has expired' })

function requireEnabled(project: ParseObject): void {
  if (!anonymousEnabled(project)) throw createError({ statusCode: 403, statusMessage: 'This project does not allow email-only access' })
}

async function rowsForEmail(project: ParseObject, email: string): Promise<ParseObject[]> {
  const Parse = useParse()
  const byEmail = new Parse.Query('EndUser').equalTo('project', project).equalTo('email', email)
  const byPending = new Parse.Query('EndUser').equalTo('project', project).equalTo('pendingEmail', email)
  return Parse.Query.or(byEmail, byPending).limit(20).find(MASTER)
}

async function createAnonymousRow(project: ParseObject, email: string, name: string): Promise<ParseObject> {
  const row = new (useParse().Object.extend('EndUser'))() as ParseObject
  row.set('project', project)
  row.set('externalId', newAnonExternalId())
  row.set('anonymous', true)
  row.set('pendingEmail', email)
  if (name) row.set('name', name)
  row.set('subscription', 'none')
  row.set('origin', { type: 'app', id: '', at: new Date().toISOString() })
  row.set('anonWrites', 0)
  row.set('lastSeenAt', new Date())
  await row.save(null, MASTER)
  return row
}

async function mintSession(event: H3Event, project: ParseObject, row: ParseObject, expiresAt?: Date): Promise<string> {
  const { token, hash, prefix } = newEndUserToken()
  const session = new (useParse().Object.extend('EndUserSession'))() as ParseObject
  session.set('project', project)
  session.set('endUser', row)
  session.set('hash', hash)
  session.set('prefix', prefix)
  session.set('lastUsedAt', new Date())
  if (expiresAt) session.set('expiresAt', expiresAt)
  session.set('ip', clientIp(event) || '')
  session.set('ua', String(getHeader(event, 'user-agent') || '').slice(0, 300))
  await session.save(null, MASTER)
  return token
}

/** Drop guest sessions that ran out, and guests who never wrote anything and have not been back for as long as a session lasts. */
export async function purgeIdleGuests(max = 2000): Promise<{ sessions: number, guests: number }> {
  const Parse = useParse()
  const cutoff = new Date(Date.now() - GUEST_SESSION_IDLE_DAYS * 86400_000)
  const expired = await new Parse.Query('EndUserSession').lessThan('expiresAt', new Date()).limit(Math.min(max, 1000)).find(MASTER)
  await Parse.Object.destroyAll(expired, MASTER)
  const idle = await new Parse.Query('EndUser').equalTo('guest', true).lessThan('lastSeenAt', cutoff).equalTo('anonWrites', 0).limit(Math.min(max, 1000)).find(MASTER)
  for (const row of idle) await revokeEndUserSessions(row)
  await Parse.Object.destroyAll(idle, MASTER)
  return { sessions: expired.length, guests: idle.length }
}

/** End every session of one person (their data is erased, or they just proved their address). */
export async function revokeEndUserSessions(row: ParseObject): Promise<number> {
  const Parse = useParse()
  let count = 0
  for (;;) {
    const rows = await new Parse.Query('EndUserSession').equalTo('endUser', row).limit(200).find(MASTER)
    if (!rows.length) return count
    await Parse.Object.destroyAll(rows, MASTER)
    count += rows.length
    if (rows.length < 200) return count
  }
}

async function sendCode(project: ParseObject, row: ParseObject, email: string): Promise<void> {
  // The form can be pointed at someone else's address: a few mails a day per address, and the same answer either way.
  try {
    await rateLimit(`sb:rl:anoncode:${project.id}:${addressKey(email)}`, LIMITS.anonCodeMailsPerAddress.limit, LIMITS.anonCodeMailsPerAddress.window)
  } catch {
    return
  }
  const code = newVerifyCode()
  row.set('verifyCodeHash', hashVerifyCode(row.id || '', code))
  row.set('verifyExpiresAt', new Date(Date.now() + CODE_TTL_MS))
  row.set('verifyAttempts', 0)
  await row.save(null, MASTER)

  const name = String(row.get('name') || '')
  const projectName = String(project.get('name') || '')
  const rendered = renderMessageEmail({
    appName: projectName,
    senderName: projectName,
    recipientName: name,
    subject: `Your ${projectName || 'verification'} code: ${code}`,
    body: `Your verification code is ${code}.\n\nIt works for ${Math.round(CODE_TTL_MS / 60000)} minutes. If you did not ask for it, ignore this message: nobody can use your address without it.`,
    attachmentUrls: [],
    poweredBy: await poweredByFor(project)
  })
  try {
    await deliverEmails([{
      project,
      to: { email, name },
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      sender: projectEmailSender(project),
      log: { source: 'notification', kind: 'message', templateName: 'Email verification', variables: { code }, batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
    }])
  } catch (error) {
    // A plan limit or a mail outage must not tell the caller anything about the address.
    console.warn('[anonymous] verification mail not sent:', (error as Error).message)
  }
}

export type AnonymousSession = { status: 'token', token: string, externalId: string, verified: boolean } | { status: 'code_sent' }

/** Open a session for an address: a token at once for a new one, a mailed code for one already known. */
export async function startAnonymousSession(event: H3Event, project: ParseObject, input: { email: string, name: string }): Promise<AnonymousSession> {
  requireEnabled(project)
  await rateLimit(`sb:rl:anonsession:${clientIp(event) || 'ip'}`, LIMITS.anonSessionsPerIp.limit, LIMITS.anonSessionsPerIp.window)
  await rateLimit(`sb:rl:anonsession:p:${project.id}`, LIMITS.anonSessionsPerProject.limit, LIMITS.anonSessionsPerProject.window)

  const run = await runExclusive(`sb:anon:mint:${project.id}:${addressKey(input.email)}`, 15, async (): Promise<AnonymousSession> => {
    const rows = await rowsForEmail(project, input.email)
    if (!rows.length) {
      const row = await createAnonymousRow(project, input.email, input.name)
      return { status: 'token', token: await mintSession(event, project, row), externalId: String(row.get('externalId')), verified: false }
    }
    const row = rows.find(r => r.get('anonymous') === true) || await createAnonymousRow(project, input.email, input.name)
    await sendCode(project, row, input.email)
    return { status: 'code_sent' }
  }, { waitMs: 3000, failOpen: true })
  if (!run.ran) throw createError({ statusCode: 429, statusMessage: 'Try again in a moment', data: { retryAfter: 5 } })
  return run.value
}

const guestExpiry = () => new Date(Date.now() + GUEST_SESSION_IDLE_DAYS * 86400_000)

/** Open a session for a visitor who gave nothing: a new guest each time, so the app keeps the token. */
export async function startGuestSession(event: H3Event, project: ParseObject): Promise<{ token: string, externalId: string, name: string, surfaces: GuestSurface[] }> {
  const surfaces = guestSurfacesOf(project)
  if (!surfaces.length) throw createError({ statusCode: 403, statusMessage: 'This project does not allow guest access' })
  await rateLimit(`sb:rl:guestsession:${clientIp(event) || 'ip'}`, LIMITS.guestSessionsPerIp.limit, LIMITS.guestSessionsPerIp.window)
  await rateLimit(`sb:rl:guestsession:p:${project.id}`, LIMITS.guestSessionsPerProject.limit, LIMITS.guestSessionsPerProject.window)

  const externalId = newGuestExternalId()
  const name = guestDisplayName(externalId)
  const row = new (useParse().Object.extend('EndUser'))() as ParseObject
  row.set('project', project)
  row.set('externalId', externalId)
  row.set('anonymous', true)
  row.set('guest', true)
  row.set('name', name)
  row.set('subscription', 'none')
  row.set('origin', { type: 'app', id: '', at: new Date().toISOString() })
  row.set('anonWrites', 0)
  row.set('lastSeenAt', new Date())
  await row.save(null, MASTER)
  return { token: await mintSession(event, project, row, guestExpiry()), externalId, name, surfaces }
}

/** Send (or re-send) a code to an address that has an email-only user. Says nothing about whether it does. */
export async function requestAnonymousCode(event: H3Event, project: ParseObject, email: string): Promise<void> {
  requireEnabled(project)
  await rateLimit(`sb:rl:anoncode:ip:${clientIp(event) || 'ip'}`, LIMITS.anonCodesPerIp.limit, LIMITS.anonCodesPerIp.window)
  const row = (await rowsForEmail(project, email)).find(r => r.get('anonymous') === true)
  if (row) await sendCode(project, row, email)
}

/** Check a code. On success the address is verified, every earlier session is closed (whoever typed the address first loses it) and a fresh token comes back. */
export async function confirmAnonymousCode(event: H3Event, project: ParseObject, email: string, code: string): Promise<{ token: string, externalId: string, verified: true }> {
  requireEnabled(project)
  await rateLimit(`sb:rl:anonconfirm:ip:${clientIp(event) || 'ip'}`, LIMITS.anonConfirmPerIp.limit, LIMITS.anonConfirmPerIp.window)
  await rateLimit(`sb:rl:anonconfirm:${project.id}:${addressKey(email)}`, LIMITS.anonConfirmPerAddress.limit, LIMITS.anonConfirmPerAddress.window)

  const rows = await rowsForEmail(project, email)
  const row = rows.find(r => r.get('anonymous') === true)
  if (!row) throw wrongCode()
  const expires = row.get('verifyExpiresAt') as Date | undefined
  const state = { hash: String(row.get('verifyCodeHash') || ''), expiresAt: expires instanceof Date ? expires.getTime() : 0, attempts: Number(row.get('verifyAttempts') || 0) }
  const checked = checkVerifyCode(state, row.id || '', code)
  if (checked === 'locked') throw createError({ statusCode: 429, statusMessage: 'Too many wrong codes. Ask for a new one.', data: { retryAfter: 600 } })
  if (checked !== 'ok') {
    if (checked === 'wrong') { row.increment('verifyAttempts'); await row.save(null, MASTER) }
    throw wrongCode()
  }

  row.unset('verifyCodeHash')
  row.unset('verifyExpiresAt')
  row.unset('verifyAttempts')
  row.set('emailVerifiedAt', new Date())
  // The address becomes the contact's email unless another row (a newsletter contact, a host user) already holds it.
  if (!rows.some(r => r.id !== row.id && r.get('email') === email)) {
    row.set('email', email)
    row.unset('pendingEmail')
  }
  await row.save(null, MASTER)
  await revokeEndUserSessions(row)
  return { token: await mintSession(event, project, row), externalId: String(row.get('externalId')), verified: true }
}

/** The bearer-token branch of verifyEndUserToken for `eu_…` tokens. */
export async function verifyAnonymousToken(event: H3Event, token: string): Promise<{ project: ParseObject, claims: IdentityClaims }> {
  const bad = async (message: string) => {
    await rateLimit(`sb:rl:badtoken:${clientIp(event) || 'ip'}`, LIMITS.badTokensPerIp.limit, LIMITS.badTokensPerIp.window)
    return createError({ statusCode: 401, statusMessage: message })
  }
  if (!isEndUserToken(token)) throw await bad('Invalid session token')
  const Parse = useParse()
  const session = await new Parse.Query('EndUserSession').equalTo('hash', hashEndUserToken(token)).include('endUser').include('project').first(MASTER)
  const row = session?.get('endUser') as ParseObject | undefined
  const stored = session?.get('project') as ParseObject | undefined
  if (!session || !row || !stored) throw await bad('Invalid session token')
  // By public key, so a suspended workspace closes this door like every other.
  const project = await findProjectByPublicKey(String(stored.get('publicKey') || ''))
  if (!project || project.id !== stored.id) throw await bad('Invalid session token')
  const guest = row.get('guest') === true
  if (guest) {
    // Closing every surface ends guest access at once; an idle session also runs out.
    if (!guestSurfacesOf(project).length) throw createError({ statusCode: 401, statusMessage: 'This project no longer allows guest access' })
    const expiresAt = session.get('expiresAt') as Date | undefined
    if (expiresAt instanceof Date && expiresAt.getTime() < Date.now()) throw await bad('Invalid session token')
  } else if (!anonymousEnabled(project)) throw createError({ statusCode: 401, statusMessage: 'This project no longer allows email-only access' })

  await rateLimit(`sb:rl:project:${project.id}`, LIMITS.requestsPerProject.limit, LIMITS.requestsPerProject.window)
  const last = session.get('lastUsedAt') as Date | undefined
  if (!last || Date.now() - last.getTime() > 10 * 60 * 1000) {
    session.set('lastUsedAt', new Date())
    if (guest) session.set('expiresAt', guestExpiry())
    void session.save(null, MASTER).catch(() => {})
  }

  const verified = row.get('emailVerifiedAt') instanceof Date
  const email = verified ? String(row.get('email') || row.get('pendingEmail') || '') : ''
  const name = String(row.get('name') || '')
  const now = Math.floor(Date.now() / 1000)
  return {
    project,
    claims: { iss: String(project.get('publicKey')), sub: String(row.get('externalId')), ...(name ? { name } : {}), ...(email ? { email } : {}), anon: true, ...(guest ? { guest: true } : {}), emailVerified: verified, iat: now, exp: now + 3600 }
  }
}

const guestRefused = (surface: GuestSurface) => createError({ statusCode: 403, statusMessage: 'Guests cannot do that here', data: { code: 'guest_not_allowed', surface } })

/**
 * Called before an email-only user or a guest writes, with the surface the
 * write belongs to. A guest only passes on a surface the admin opened, within
 * their own and the project's write limits. An email-only user's write is
 * counted and, once an unverified person is past their free ones, refused with
 * a code the app can act on. Host-signed users and verified ones pass untouched.
 */
export async function anonymousWriteGate(project: ParseObject, claims: IdentityClaims, surface: GuestSurface): Promise<void> {
  if (claims.guest) {
    if (!guestSurfacesOf(project).includes(surface)) throw guestRefused(surface)
    await rateLimit(`sb:rl:guestwrite:${project.id}:${claims.sub}`, GUEST_WRITES_PER_10_MIN, 600)
    await rateLimit(`sb:rl:guestwrite:day:${project.id}:${claims.sub}`, GUEST_WRITES_PER_DAY, 86400)
    await rateLimit(`sb:rl:guestwrite:p:${project.id}`, GUEST_WRITES_PER_PROJECT_HOUR, 3600)
  } else if (!claims.anon || claims.emailVerified) return
  const Parse = useParse()
  const row = await new Parse.Query('EndUser').equalTo('project', project).equalTo('externalId', claims.sub).first(MASTER)
  if (!row) return
  row.increment('anonWrites')
  await row.save(null, MASTER)
  // A guest has no address to verify; their count only tells the purge (server/plugins/guestPurge.ts) who ever wrote.
  if (!claims.guest && needsVerification(Number(row.get('anonWrites') || 0), false)) throw verifyRequired()
}

/** For what an unverified person may not do at all (uploads). A guest has no address to verify, so for them it is a plain no. */
export function requireVerifiedAnonymous(claims: IdentityClaims): void {
  if (claims.guest) throw createError({ statusCode: 403, statusMessage: 'Guests cannot upload files', data: { code: 'guest_upload_not_allowed' } })
  if (claims.anon && !claims.emailVerified) throw verifyRequired()
}
