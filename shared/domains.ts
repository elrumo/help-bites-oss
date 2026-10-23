// Custom domains for a project's public pages (feedback.lightbites.app,
// change.lightbites.app). A host belongs to one project; what its "/" shows is
// its target. Everything here is pure: the DNS lookups are in
// server/utils/projectDomains.ts and the native app copies the constants.

/** What a custom host shows at "/". Every other public page is reachable under it too. */
export const DOMAIN_TARGETS = ['hub', 'feedback', 'roadmap', 'changelog', 'blog'] as const
export type DomainTarget = typeof DOMAIN_TARGETS[number]

export const DOMAIN_STATES = ['pending', 'verified', 'failed'] as const
export type DomainState = typeof DOMAIN_STATES[number]

export const PROJECT_DOMAIN_LIMIT = 5

/** The TXT record that proves the host is the operator's is `_helpbites.<host>` = `helpbites-verify=<token>`. */
export const VERIFY_LABEL = '_helpbites'
export const VERIFY_PREFIX = 'helpbites-verify='

export type DomainDnsRecord = {
  purpose: 'ownership' | 'routing'
  type: 'TXT' | 'CNAME' | 'A'
  host: string
  value: string
  /** Last check: valid, invalid, or unknown (not checked yet). */
  valid: 'valid' | 'invalid' | 'unknown'
}

export type ProjectDomainDto = {
  id: string
  host: string
  target: DomainTarget
  state: DomainState
  dnsRecords: DomainDnsRecord[]
  verifiedAt: string | null
  lastCheckedAt: string | null
}

// Names that never resolve on the public internet.
const PRIVATE_TLDS = new Set(['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'lan', 'home', 'corp', 'intranet', 'onion'])
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A host as stored: lower-case, punycode, no scheme, path, port or trailing
 * dot. Null for anything that is not a public DNS name with at least two labels.
 */
export function normalizeHost(input: unknown): string | null {
  let value = String(input || '').trim().toLowerCase()
  if (!value || /\s/.test(value)) return null
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
  try {
    value = new URL(`http://${value}`).hostname
  } catch {
    return null
  }
  if (value.length > 253 || value.includes('*')) return null
  const labels = value.split('.')
  if (labels.length < 2 || !labels.every(label => LABEL_RE.test(label))) return null
  const tld = labels[labels.length - 1]!
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld) || PRIVATE_TLDS.has(tld)) return null
  return value
}

/** A host with only a registrable name (lightbites.app): it cannot hold a CNAME. A rough test; two-part suffixes (co.uk) read as subdomains. */
export function isApexHost(host: string): boolean {
  return host.split('.').length === 2
}

export function domainDnsRecords(host: string, token: string, target: string, ip = ''): DomainDnsRecord[] {
  const routing: DomainDnsRecord = ip && isApexHost(host)
    ? { purpose: 'routing', type: 'A', host, value: ip, valid: 'unknown' }
    : { purpose: 'routing', type: 'CNAME', host, value: target, valid: 'unknown' }
  return [
    { purpose: 'ownership', type: 'TXT', host: `${VERIFY_LABEL}.${host}`, value: `${VERIFY_PREFIX}${token}`, valid: 'unknown' },
    routing
  ]
}

export function isDomainTarget(value: unknown): value is DomainTarget {
  return typeof value === 'string' && (DOMAIN_TARGETS as readonly string[]).includes(value)
}

// ---- routing on a custom host ---------------------------------------------------

/** Pages that live under /<prefix>/<public key>/…: on a custom host the key is filled in. */
const KEYED_PREFIXES = ['hub', 'blog', 'legal', 'brand', 'p', 'changelog', 'roadmap', 'pricing', 'f', 's']
const PK_RE = /^pk_[0-9a-f]{24}$/
const PASS_PREFIXES = ['/_nuxt/', '/_fonts/', '/_ipx/', '/__nuxt', '/embed']
const PASS_FILES = /^\/(?:[a-z0-9-]+\.js|favicon\.ico|robots\.txt)$/

export type HostRoute = { kind: 'pass' } | { kind: 'rewrite', path: string } | { kind: 'notFound' }

/**
 * What a request to a custom host becomes. `path` includes the query string.
 * The panel, its API (/v1/admin, /v1/internal), login and docs are not served
 * there: a custom host is a public page, nothing more.
 */
export function routeForHost(path: string, pk: string): HostRoute {
  const queryAt = path.indexOf('?')
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt)
  const query = queryAt === -1 ? '' : path.slice(queryAt)
  if (pathname === '/_domain') return { kind: 'pass' }
  // Normally the proxy sends "/" here (the static home page is served before middleware); a proxy that cannot reaches the same place.
  if (pathname === '/') return { kind: 'rewrite', path: `/_domain${query}` }
  if (pathname.startsWith('/v1/')) return /^\/v1\/(?:admin|internal)(?:\/|$)/.test(pathname) ? { kind: 'notFound' } : { kind: 'pass' }
  if (PASS_FILES.test(pathname) || PASS_PREFIXES.some(prefix => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix))) return { kind: 'pass' }
  const [, first = '', second = '', ...rest] = pathname.split('/')
  if (!KEYED_PREFIXES.includes(first)) return { kind: 'notFound' }
  if (PK_RE.test(second)) return second === pk ? { kind: 'pass' } : { kind: 'notFound' }
  const tail = [second, ...rest].filter((part, i, all) => part || i < all.length - 1)
  return { kind: 'rewrite', path: `/${first}/${pk}${tail.length ? `/${tail.join('/')}` : ''}${query}` }
}

/** Where "/" goes for a target. Relative, so it stays on the custom host. */
export function homePathFor(target: DomainTarget, pk: string): string {
  const key = encodeURIComponent(pk)
  switch (target) {
    case 'feedback': return `/embed/feedback?pk=${key}`
    case 'roadmap': return `/roadmap/${key}`
    case 'changelog': return `/changelog/${key}`
    case 'blog': return `/blog/${key}`
    default: return `/hub/${key}`
  }
}
