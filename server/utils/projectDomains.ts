import { randomBytes } from 'node:crypto'
import { promises as nodeDns } from 'node:dns'
import { createError, type H3Event } from 'h3'
import { DOMAIN_STATES, PROJECT_DOMAIN_LIMIT, VERIFY_LABEL, VERIFY_PREFIX, domainDnsRecords, isDomainTarget, normalizeHost, type DomainDnsRecord, type DomainState, type DomainTarget, type ProjectDomainDto } from '#shared/domains'
import { MASTER, iso, useParse, type ParseObject } from './parse'
import { invalidate, onInvalidate } from './cacheBus'
import { rateLimit } from './rateLimit'
import { runExclusive } from './redis'
import { assertFeature, hasFeature, projectWorkspaceId } from './usage'
import { findProjectByPublicKey } from './projects'

// The hosts a project's public pages are served on. An operator adds a host,
// puts two records in DNS (a TXT that proves it is theirs, a CNAME or A that
// points it at this deployment) and verifies; from then on the request
// middleware (middleware/customDomain.ts) answers for it and the reverse
// proxy's TLS check (routes/v1/internal/domain-check.get.ts) lets it get a certificate.

export type Dns = {
  txt(name: string): Promise<string[]>
  cname(name: string): Promise<string[]>
  a(name: string): Promise<string[]>
}

export const systemDns: Dns = {
  txt: name => nodeDns.resolveTxt(name).then(rows => rows.map(chunks => chunks.join(''))),
  cname: name => nodeDns.resolveCname(name),
  a: name => nodeDns.resolve4(name)
}

const hostOf = (url: string) => {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

/** Where a custom host must point: CUSTOM_DOMAIN_TARGET, else this deployment's own host. */
export function domainTarget(): string {
  return (process.env.CUSTOM_DOMAIN_TARGET || '').trim().toLowerCase() || hostOf(process.env.APP_URL || '')
}

/** Hosts nobody may claim: this deployment's own, and any suffix listed in CUSTOM_DOMAIN_RESERVED. */
export function isReservedHost(host: string): boolean {
  const own = [hostOf(process.env.APP_URL || ''), hostOf(process.env.ADMIN_URL || ''), domainTarget()].filter(Boolean)
  if (own.includes(host)) return true
  return (process.env.CUSTOM_DOMAIN_RESERVED || '').split(',').map(s => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
    .some(suffix => host === suffix || host.endsWith(`.${suffix}`))
}

const lower = (value: string) => value.toLowerCase().replace(/\.$/, '')

async function lookup<T>(promise: Promise<T[]>): Promise<T[]> {
  return promise.catch(() => [])
}

/** Check both records and say which hold. The TXT proves ownership; the CNAME (or an A record matching ours) proves the host reaches us. */
export async function checkDomainRecords(host: string, token: string, dns: Dns = systemDns): Promise<{ ownership: boolean, routing: boolean }> {
  const txt = await lookup(dns.txt(`${VERIFY_LABEL}.${host}`))
  const ownership = txt.some(value => value.trim() === `${VERIFY_PREFIX}${token}`)
  const target = domainTarget()
  const ip = (process.env.CUSTOM_DOMAIN_IP || '').trim()
  let routing = (await lookup(dns.cname(host))).some(name => lower(name) === target)
  if (!routing) {
    const mine = await lookup(dns.a(host))
    routing = mine.length > 0 && (mine.includes(ip) || (await lookup(dns.a(target))).some(address => mine.includes(address)))
  }
  return { ownership, routing }
}

function withResult(records: DomainDnsRecord[], result: { ownership: boolean, routing: boolean }): DomainDnsRecord[] {
  return records.map(record => ({ ...record, valid: (record.purpose === 'ownership' ? result.ownership : result.routing) ? 'valid' : 'invalid' }))
}

export function serializeProjectDomain(row: ParseObject): ProjectDomainDto {
  const state = String(row.get('state') || 'pending') as DomainState
  return {
    id: row.id || '',
    host: String(row.get('host') || ''),
    target: (isDomainTarget(row.get('target')) ? row.get('target') : 'hub') as DomainTarget,
    state: DOMAIN_STATES.includes(state) ? state : 'pending',
    dnsRecords: (row.get('dnsRecords') || []) as DomainDnsRecord[],
    verifiedAt: iso(row.get('verifiedAt')),
    lastCheckedAt: iso(row.get('lastCheckedAt'))
  }
}

export async function listProjectDomains(project: ParseObject): Promise<ParseObject[]> {
  return new (useParse()).Query('ProjectDomain').equalTo('project', project).ascending('createdAt').limit(PROJECT_DOMAIN_LIMIT + 5).find(MASTER)
}

export async function getProjectDomain(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await new (useParse()).Query('ProjectDomain').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Domain not found' })
  return row
}

export async function addProjectDomain(project: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  const workspaceId = await projectWorkspaceId(project)
  await assertFeature(workspaceId, 'customPublicDomain')
  const host = normalizeHost(body.host)
  if (!host) throw createError({ statusCode: 400, statusMessage: 'host must be a domain such as feedback.example.com' })
  if (isReservedHost(host)) throw createError({ statusCode: 400, statusMessage: 'That host is reserved' })
  if (body.target !== undefined && !isDomainTarget(body.target)) throw createError({ statusCode: 400, statusMessage: 'target must be one of hub, feedback, roadmap, changelog, blog' })
  await rateLimit(`sb:rl:domainadd:${workspaceId}`, 30, 3600)
  if ((await listProjectDomains(project)).length >= PROJECT_DOMAIN_LIMIT) throw createError({ statusCode: 400, statusMessage: `At most ${PROJECT_DOMAIN_LIMIT} domains per project` })

  const Parse = useParse()
  const claimed = await runExclusive(`sb:projdomain:${host}`, 10, async () => {
    if (await new Parse.Query('ProjectDomain').equalTo('host', host).first(MASTER)) throw createError({ statusCode: 409, statusMessage: 'That host is already in use' })
    const token = randomBytes(16).toString('hex')
    const row = new (Parse.Object.extend('ProjectDomain'))() as ParseObject
    row.set('project', project)
    row.set('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId))
    row.set('host', host)
    row.set('target', body.target || 'hub')
    row.set('state', 'pending')
    row.set('token', token)
    row.set('dnsRecords', domainDnsRecords(host, token, domainTarget(), (process.env.CUSTOM_DOMAIN_IP || '').trim()))
    await row.save(null, MASTER)
    return row
  }, { waitMs: 2000 })
  if (!claimed.ran) throw createError({ statusCode: 409, statusMessage: 'That host is being added; try again' })
  await invalidate('projectHost', host)
  return claimed.value
}

export async function setDomainTarget(row: ParseObject, target: unknown): Promise<void> {
  if (!isDomainTarget(target)) throw createError({ statusCode: 400, statusMessage: 'target must be one of hub, feedback, roadmap, changelog, blog' })
  row.set('target', target)
  await row.save(null, MASTER)
  await invalidate('projectHost', String(row.get('host')))
}

export async function verifyProjectDomain(row: ParseObject, dns: Dns = systemDns): Promise<ParseObject> {
  await rateLimit(`sb:rl:domainverify:${row.id}`, 10, 60)
  const host = String(row.get('host'))
  const result = await checkDomainRecords(host, String(row.get('token')), dns)
  const ok = result.ownership && result.routing
  row.set('dnsRecords', withResult((row.get('dnsRecords') || []) as DomainDnsRecord[], result))
  row.set('lastCheckedAt', new Date())
  row.set('state', ok ? 'verified' : 'failed')
  if (ok && !row.get('verifiedAt')) row.set('verifiedAt', new Date())
  await row.save(null, MASTER)
  await invalidate('projectHost', host)
  return row
}

export async function removeProjectDomain(row: ParseObject): Promise<void> {
  const host = String(row.get('host'))
  await row.destroy(MASTER)
  await invalidate('projectHost', host)
}

// ---- host -> project (every request to a host that is not the app's own) -------

export type HostProject = { project: ParseObject, publicKey: string, target: DomainTarget }

const CACHE_TTL_MS = 60_000
const CACHE_MAX = 5000
const cache = new Map<string, { value: HostProject | null, expiresAt: number }>()
onInvalidate('projectHost', host => cache.delete(host))

/** The project behind a verified host; null for an unknown host, a suspended workspace or a plan without custom domains. Unknown hosts are cached too, so a scanner cannot make every request a query. */
export async function findProjectByHost(host: string): Promise<HostProject | null> {
  const hit = cache.get(host)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const row = await new (useParse()).Query('ProjectDomain').equalTo('host', host).equalTo('state', 'verified').include('project').first(MASTER)
  let value: HostProject | null = null
  const project = row?.get('project') as ParseObject | undefined
  const publicKey = String(project?.get('publicKey') || '')
  if (row && project && publicKey && await hasFeature(await projectWorkspaceId(project), 'customPublicDomain') && await findProjectByPublicKey(publicKey)) {
    value = { project, publicKey, target: (isDomainTarget(row.get('target')) ? row.get('target') : 'hub') as DomainTarget }
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(host, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

/** The origin of the custom host this request came in on (set by middleware/customDomain.ts); '' on the app's own host. Pages built for a custom host link to themselves there. */
export function customOrigin(event: H3Event): string {
  const custom = event.context.customHost as { host: string } | undefined
  return custom ? `https://${custom.host}` : ''
}

/** Hosts a project's pages are served on, for building absolute links and the origin checks. The first verified one wins. */
export async function projectHosts(project: ParseObject): Promise<string[]> {
  const rows = await new (useParse()).Query('ProjectDomain').equalTo('project', project).equalTo('state', 'verified').ascending('createdAt').limit(PROJECT_DOMAIN_LIMIT).find(MASTER)
  return rows.map(row => String(row.get('host'))).filter(Boolean)
}
