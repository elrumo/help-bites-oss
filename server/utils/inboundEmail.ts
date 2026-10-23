import { randomBytes } from 'node:crypto'
import { promises as nodeDns } from 'node:dns'
import { createError } from 'h3'
import { normalizeHost } from '#shared/domains'
import { INBOUND_ADDRESS_LIMIT, INBOUND_KINDS, INBOUND_STATES, mxPointsAtProvider, providerMxRecords, replyAddress, splitAddress, type InboundAddressDto, type InboundKind, type InboundState } from '#shared/inboundEmail'
import { MASTER, iso, useParse, type ParseObject } from './parse'
import { edition } from './edition'
import { rateLimit } from './rateLimit'
import { runExclusive } from './redis'
import { getWorkspace } from './tenancy'
import { assertFeature, projectWorkspaceId } from './usage'

// The addresses a project receives mail at. Two kinds: an address on a domain
// whose MX points at the mail provider (support@mail.example.com), and a
// HelpBites alias (in-ab12…@INBOUND_DOMAIN) that the project's own mailbox
// forwards to, so a root domain keeps the mail it has. The webhook that turns
// mail into conversations is routes/v1/webhooks/mailgun-inbound.post.ts.

/** The domain forwarding aliases live on (INBOUND_DOMAIN). Empty: this server offers no forwarding. */
export const inboundDomain = (): string => normalizeHost(process.env.INBOUND_DOMAIN || '') || ''

const mailgunDomain = () => normalizeHost(process.env.MAILGUN_DOMAIN || '') || ''

export const systemMx = (domain: string): Promise<string[]> => nodeDns.resolveMx(domain).then(rows => rows.map(row => row.exchange)).catch(() => [])

export function serializeInboundAddress(row: ParseObject): InboundAddressDto {
  const kind = (INBOUND_KINDS as readonly string[]).includes(row.get('kind')) ? row.get('kind') as InboundKind : 'forward'
  const state = (INBOUND_STATES as readonly string[]).includes(row.get('state')) ? row.get('state') as InboundState : 'pending'
  const address = String(row.get('address') || '')
  return {
    id: row.id || '',
    kind,
    address,
    publicAddress: String(row.get('publicAddress') || ''),
    fromName: String(row.get('fromName') || ''),
    state,
    mxRecords: kind === 'domain' ? providerMxRecords(address.split('@')[1] || '', process.env.MAILGUN_API_BASE_URL || 'https://api.eu.mailgun.net') : [],
    verifiedAt: iso(row.get('verifiedAt')),
    lastCheckedAt: iso(row.get('lastCheckedAt'))
  }
}

export async function listInboundAddresses(project: ParseObject): Promise<ParseObject[]> {
  return new (useParse()).Query('InboundAddress').equalTo('project', project).ascending('createdAt').limit(INBOUND_ADDRESS_LIMIT + 5).find(MASTER)
}

export async function getInboundAddress(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await new (useParse()).Query('InboundAddress').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Address not found' })
  return row
}

export async function createInboundAddress(project: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  const workspaceId = await projectWorkspaceId(project)
  await assertFeature(workspaceId, 'inboundEmail')
  const kind = body.kind
  if (!(INBOUND_KINDS as readonly unknown[]).includes(kind)) throw createError({ statusCode: 400, statusMessage: 'kind must be "domain" or "forward"' })
  await rateLimit(`sb:rl:inboundadd:${workspaceId}`, 30, 3600)
  if ((await listInboundAddresses(project)).length >= INBOUND_ADDRESS_LIMIT) throw createError({ statusCode: 400, statusMessage: `At most ${INBOUND_ADDRESS_LIMIT} addresses per project` })

  const publicAddress = body.publicAddress ? splitAddress(body.publicAddress)?.address : ''
  if (body.publicAddress && !publicAddress) throw createError({ statusCode: 400, statusMessage: 'publicAddress must be an email address such as support@example.com' })
  let address: string
  let state: InboundState
  if (kind === 'forward') {
    const domain = inboundDomain()
    if (!domain) throw createError({ statusCode: 400, statusMessage: 'This server has no INBOUND_DOMAIN, so it cannot offer a forwarding address' })
    // An unguessable local part: whoever knows the alias can write into the inbox.
    address = `in-${randomBytes(8).toString('hex')}@${domain}`
    state = 'verified'
  } else {
    const parts = splitAddress(body.address)
    if (!parts) throw createError({ statusCode: 400, statusMessage: 'address must be an email address such as support@mail.example.com' })
    if (parts.domain === inboundDomain() || parts.domain === mailgunDomain()) throw createError({ statusCode: 400, statusMessage: 'That domain is reserved' })
    const workspace = await getWorkspace(workspaceId)
    const allowed = workspace ? await edition().canReceiveFor?.(workspace, parts.domain) : true
    if (allowed === false) throw createError({ statusCode: 403, statusMessage: 'Verify that domain for this workspace first' })
    address = parts.address
    state = 'pending'
  }

  const Parse = useParse()
  const claimed = await runExclusive(`sb:inboundaddr:${address}`, 10, async () => {
    if (await new Parse.Query('InboundAddress').equalTo('address', address).first(MASTER)) throw createError({ statusCode: 409, statusMessage: 'That address is already in use' })
    const row = new (Parse.Object.extend('InboundAddress'))() as ParseObject
    row.set('project', project)
    row.set('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId))
    row.set('address', address)
    row.set('kind', kind)
    row.set('publicAddress', publicAddress || '')
    row.set('fromName', String(body.fromName || '').trim().slice(0, 80))
    row.set('state', state)
    if (state === 'verified') row.set('verifiedAt', new Date())
    await row.save(null, MASTER)
    return row
  }, { waitMs: 2000 })
  if (!claimed.ran) throw createError({ statusCode: 409, statusMessage: 'That address is being added; try again' })
  return claimed.value
}

/** Look up the MX records of a `domain` address and mark it verified when they reach the mail provider. A forwarding alias has nothing to check. */
export async function verifyInboundAddress(row: ParseObject, mx: (domain: string) => Promise<string[]> = systemMx): Promise<ParseObject> {
  if (row.get('kind') !== 'domain') return row
  await rateLimit(`sb:rl:inboundverify:${row.id}`, 10, 60)
  const ok = mxPointsAtProvider(await mx(String(row.get('address')).split('@')[1] || ''))
  row.set('state', ok ? 'verified' : 'failed')
  row.set('lastCheckedAt', new Date())
  if (ok && !row.get('verifiedAt')) row.set('verifiedAt', new Date())
  await row.save(null, MASTER)
  return row
}

export async function removeInboundAddress(row: ParseObject): Promise<void> {
  await row.destroy(MASTER)
}

/** The verified address mail was sent to, with its project loaded; null for an unknown, unverified or removed address. */
export async function findInboundAddress(address: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('InboundAddress').equalTo('address', address).equalTo('state', 'verified').include('project').first(MASTER) || null
}

/** Who a reply to this conversation is sent as, and where people answer: the project's first verified address, with the conversation id in it. Null when it has none. */
export async function emailReplyContext(project: ParseObject, conversation: ParseObject): Promise<{ replyTo: string, fromEmail: string, fromName: string } | null> {
  const row = await new (useParse()).Query('InboundAddress').equalTo('project', project).equalTo('state', 'verified').ascending('createdAt').first(MASTER)
  if (!row) return null
  const shown = String(row.get('publicAddress') || '') || String(row.get('address'))
  return {
    replyTo: replyAddress(shown, conversation.id || ''),
    fromEmail: row.get('kind') === 'domain' ? String(row.get('address')) : String(row.get('publicAddress') || ''),
    fromName: String(row.get('fromName') || '')
  }
}

/** In-Reply-To and References for the next mail of a conversation: the ids of the mails already in it, oldest first. */
export async function threadHeaders(conversation: ParseObject): Promise<Record<string, string>> {
  const rows = await new (useParse()).Query('Message').equalTo('conversation', conversation).exists('emailMessageId').ascending('createdAt').limit(20).find(MASTER)
  const ids = rows.map(row => String(row.get('emailMessageId'))).filter(Boolean)
  return ids.length ? { 'In-Reply-To': ids[ids.length - 1]!, 'References': ids.join(' ') } : {}
}
