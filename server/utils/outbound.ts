import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createError } from 'h3'

// Requests to addresses an operator typed in (a Parse server URL, a database
// host, a webhook, their own AI provider): never to cloud metadata or
// link-local addresses, and never to the private network unless
// ALLOW_PRIVATE_NETWORK=1 says this deployment talks to databases next to it
// (self-hosting on one box).
//
// A name is resolved once and the connection goes to the address that was
// checked. Resolving again to connect would let a DNS server answer a public
// address to the check and 127.0.0.1 to the connection (DNS rebinding).
// fetch() gets the IP in the URL, the name in the Host header and, for https,
// the name as tls.serverName: Bun 1.4 sends that as SNI, checks the
// certificate against it and does not reuse a connection made for another
// name. Behind HTTP(S)_PROXY the proxy is asked to connect to the IP, so a
// proxy that allows hosts by name refuses these requests.

export type AddressClass = 'public' | 'private' | 'blocked'

type Resolver = (hostname: string) => Promise<string[]>
type OutboundInit = RequestInit & { timeoutMs?: number }

const systemResolver: Resolver = async hostname => (await lookup(hostname, { all: true }).catch(() => [])).map(a => a.address)
let resolveHost = systemResolver

/** Tests: answer every lookup with `fake`; without it, the system resolver again. */
export function setResolver(fake?: Resolver): void {
  resolveHost = fake || systemResolver
}

function v4(ip: string): number[] {
  return ip.split('.').map(Number)
}

/** The IPv4 address inside an IPv6 one, in either notation: mapped
 *  (::ffff:a.b.c.d), compatible (::a.b.c.d) or NAT64 (64:ff9b::a.b.c.d). The
 *  URL parser rewrites [::ffff:127.0.0.1] as [::ffff:7f00:1], so the dotted
 *  form alone is not enough. */
function embeddedV4(ip: string): string | null {
  let text = ip
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = v4(dotted[2]!)
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', tail = ''] = text.split('::')
  const left = head ? head.split(':') : []
  const right = text.includes('::') && tail ? tail.split(':') : []
  const words = (text.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left).map(w => Number.parseInt(w, 16))
  if (words.length !== 8) return null
  const [w0, w1, w2, w3, w4, w5, hi = 0, lo = 0] = words
  const zero = (...list: (number | undefined)[]) => list.every(w => w === 0)
  if ((zero(w0, w1, w2, w3, w4) && (w5 === 0 || w5 === 0xffff)) || (w0 === 0x64 && w1 === 0xff9b && zero(w2, w3, w4, w5))) {
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return null
}

export function classifyAddress(address: string): AddressClass {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(ip) === 6 && ip !== '::1') ip = embeddedV4(ip) || ip
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = v4(ip)
    if (a === 169 && b === 254) return 'blocked' // link-local, cloud metadata
    if (a === 0 || a >= 224) return 'blocked' // "this network", multicast, reserved, broadcast
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'private'
    return 'public'
  }
  if (isIP(ip) === 6) {
    if (ip === '::' || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('ff') || ip.startsWith('fd00:ec2:')) return 'blocked'
    if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')) return 'private'
    return 'public'
  }
  return 'blocked'
}

/** Refuse a host that resolves anywhere this server must not reach. The addresses it checked, the ones to connect to. */
export async function assertReachableHost(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : await resolveHost(host)
  if (!addresses.length) throw createError({ statusCode: 400, statusMessage: `${hostname} does not resolve` })
  const classes = addresses.map(classifyAddress)
  if (classes.includes('blocked')) throw createError({ statusCode: 400, statusMessage: `${hostname} is not an address HelpBites will connect to` })
  if (classes.includes('private') && process.env.ALLOW_PRIVATE_NETWORK !== '1') {
    throw createError({ statusCode: 400, statusMessage: `${hostname} is on a private network. Self-hosting next to that database? Set ALLOW_PRIVATE_NETWORK=1 on the server.` })
  }
  // IPv4 first: a container without an IPv6 route still reaches a host that has both.
  return [...addresses].sort((a, b) => isIP(a) - isIP(b))
}

/** fetch() to the address the host was checked at, not to whatever its name resolves to next. No redirects, a timeout. */
export async function pinnedFetch(url: string | URL, init: OutboundInit = {}): Promise<Response> {
  const target = new URL(url)
  const { host, hostname, protocol } = target
  const [address] = await assertReachableHost(hostname)
  const { timeoutMs = 20_000, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  const options = { ...rest, redirect: 'manual' as const, signal: rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout }
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) return fetch(target, options)
  target.hostname = isIP(address!) === 6 ? `[${address}]` : address!
  const headers = new Headers(rest.headers)
  headers.set('host', host)
  return fetch(target, { ...options, headers, ...(protocol === 'https:' ? { tls: { serverName: hostname } } : {}) })
}

/** fetch() to an operator-supplied URL: http(s) only, a reachable host, no redirects, a timeout. */
export async function safeFetch(url: string, init: OutboundInit = {}): Promise<Response> {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw createError({ statusCode: 400, statusMessage: 'Not a URL' }) }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw createError({ statusCode: 400, statusMessage: 'Only http(s) URLs' })
  const response = await pinnedFetch(parsed, init)
  if (response.status >= 300 && response.status < 400) throw createError({ statusCode: 502, statusMessage: `${parsed.host} answered with a redirect; use the final URL` })
  return response
}
