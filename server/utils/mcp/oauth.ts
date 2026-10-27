import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, getRequestURL, type H3Event } from 'h3'
import { resolveAppUrl } from '#shared/appUrl'
import { readLinkToken, signLinkToken } from '../secrets'

// What claude.ai, ChatGPT and other assistants that cannot send a custom header
// need to connect: OAuth 2.1 with PKCE and dynamic client registration. It is
// a thin front for the admin API keys that already exist. The operator signs
// in to the panel and approves (app/pages/oauth/authorize.vue); the token
// endpoint mints an ordinary `ak_` key, named after the assistant and shown
// in Settings → API keys. Rotating refresh tokens are tied to that key, so
// revoking it cuts the assistant off.

const CLIENT_PURPOSE = 'mcp-client'
const CODE_PREFIX = 'sb:mcp:code:'
const REFRESH_PREFIX = 'sb:mcp:refresh:'
/** Seconds an authorization code can be exchanged for. */
export const CODE_TTL_SECONDS = 120
/** An access token is an API key: it is renewed through the refresh token (each use re-stamps it), so a connection in use stays and one forgotten ends. */
export const OAUTH_KEY_DAYS = 30
export const OAUTH_REFRESH_DAYS = 90
/** A refresh token used twice this close together is a client retrying or two of its tabs racing; later it is a copy someone kept. */
export const REFRESH_REUSE_GRACE_MS = 60_000
const MAX_REDIRECT_URIS = 5

// What a client may send the browser back to: the web, a loopback address (a desktop assistant listening on localhost), the
// custom scheme of an editor that registers one, or a reverse-domain scheme (`com.example.app:`, RFC 8252 7.1). Any other
// scheme (`search-ms:`, `ms-msdt:`, `intent:`, `ws:`…) opens a local handler with a link an attacker wrote.
const APP_SCHEMES = new Set(['claude', 'cursor', 'vscode', 'vscode-insiders', 'windsurf', 'zed'])
// Assistants that run on the web, whose address on the consent page is no surprise.
const KNOWN_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'openai.com']
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

export type McpClient = { name: string, redirectUris: string[] }

/** The public address OAuth metadata names: APP_URL when it is a real address, else the one the request came in on. */
export function publicOrigin(event: H3Event): string {
  return resolveAppUrl(String(process.env.APP_URL || '').trim(), getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin)
}

/** https, a loopback address (a desktop assistant listening on localhost), or an app's own scheme (cursor://, vscode://). */
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.hash) return false
  const scheme = url.protocol.slice(0, -1)
  if (scheme === 'https') return Boolean(url.hostname) && !url.username && !url.password
  if (scheme === 'http') return LOOPBACK_HOSTS.includes(url.hostname)
  return APP_SCHEMES.has(scheme) || /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(scheme)
}

/** Whether the consent page can say this address is an assistant the operator is likely to know: a known web host, loopback or an editor's own scheme. */
export function knownRedirect(uri: string): boolean {
  let url: URL
  try { url = new URL(uri) } catch { return false }
  const scheme = url.protocol.slice(0, -1)
  if (scheme === 'https') return KNOWN_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  return scheme === 'http' || APP_SCHEMES.has(scheme)
}

/** An assistant names itself, so the name is shown as text and never trusted: no control, format (bidi, zero-width) or private characters, one line, 60 long. */
export function cleanClientName(value: unknown): string {
  return String(value || '').replace(/[\t\n\r\u2028\u2029]+/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/**
 * Register an assistant. The client id is the registration itself, signed: its
 * name and redirect addresses can be read back from it but not changed, so no
 * client table is needed.
 */
export function registerClient(input: Record<string, unknown>): { clientId: string, client: McpClient } {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : []
  if (!uris.length || uris.length > MAX_REDIRECT_URIS || !uris.every(validRedirectUri)) {
    throw oauthError(400, 'invalid_redirect_uri', `Give 1 to ${MAX_REDIRECT_URIS} redirect_uris: https, http on localhost, or an app's own scheme`)
  }
  const name = cleanClientName(input.client_name) || 'AI assistant'
  const client: McpClient = { name, redirectUris: [...new Set(uris as string[])] }
  return { clientId: signLinkToken(CLIENT_PURPOSE, JSON.stringify({ n: client.name, r: client.redirectUris })), client }
}

export function readClient(clientId: unknown): McpClient | null {
  const payload = readLinkToken(CLIENT_PURPOSE, String(clientId || ''))
  if (!payload) return null
  try {
    const { n, r } = JSON.parse(payload) as { n?: unknown, r?: unknown }
    return typeof n === 'string' && Array.isArray(r) && r.every(validRedirectUri) ? { name: n, redirectUris: r } : null
  } catch { return null }
}

/** A client, only when it asks for an address it registered: 400 either way, so nothing says which part was wrong. */
export function requireClient(clientId: unknown, redirectUri: unknown): McpClient {
  const client = readClient(clientId)
  if (!client || typeof redirectUri !== 'string' || !client.redirectUris.includes(redirectUri)) throw oauthError(400, 'invalid_request', 'Unknown client or redirect_uri')
  return client
}

/** RFC 7636 S256: the challenge is the verifier's SHA-256, base64url. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  const expected = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const given = Buffer.from(challenge)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function validChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(value)
}

// ---- authorization codes -------------------------------------------------------

/** What an approved sign-in grants: this operator, in this workspace, on these projects (null: all). */
export type CodeGrant = { agentId: string, workspaceId: string, projectIds: string[] | null, clientId: string, redirectUri: string, challenge: string, clientName: string, /** The operator chose a connection that only reads. Absent in a code issued before the choice existed: it may write. */ readOnly?: boolean }
export type RefreshGrant = { agentId: string, workspaceId: string, clientId: string, apiKeyId: string }

const codeKey = (code: string) => `${CODE_PREFIX}${createHash('sha256').update(code).digest('hex')}`

export async function issueCode(grant: CodeGrant): Promise<string> {
  const code = randomBytes(32).toString('base64url')
  await useRedis().set(codeKey(code), JSON.stringify(grant), 'EX', CODE_TTL_SECONDS)
  return code
}

/** The grant behind a code, and the code is gone: one try, so a guessed or replayed code cannot be retried. */
export async function takeCode(code: unknown): Promise<CodeGrant | null> {
  if (typeof code !== 'string' || !code || code.length > 200) return null
  const raw = await useRedis().getdel(codeKey(code))
  if (!raw) return null
  try { return JSON.parse(raw) as CodeGrant } catch { return null }
}

const refreshKey = (token: string) => `${REFRESH_PREFIX}${createHash('sha256').update(token).digest('hex')}`

/** A rotating, one-use refresh token. Revoking its API key makes it unusable. */
export async function issueRefreshToken(grant: RefreshGrant): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await useRedis().set(refreshKey(token), JSON.stringify(grant), 'EX', OAUTH_REFRESH_DAYS * 24 * 60 * 60)
  return token
}

const USED_PREFIX = 'used:'

/** What a stored refresh entry is: a live grant, a spent token (and its key, and when), or nothing usable. */
export function readRefreshEntry(raw: string | null, now = Date.now()): { grant: RefreshGrant } | { reusedKeyId: string, revoke: boolean } | null {
  if (!raw) return null
  if (raw.startsWith(USED_PREFIX)) {
    const [keyId = '', at = ''] = raw.slice(USED_PREFIX.length).split(':')
    return keyId ? { reusedKeyId: keyId, revoke: now - Number(at) > REFRESH_REUSE_GRACE_MS } : null
  }
  try {
    const grant = JSON.parse(raw) as Partial<RefreshGrant>
    return typeof grant.agentId === 'string' && typeof grant.workspaceId === 'string' && typeof grant.clientId === 'string' && typeof grant.apiKeyId === 'string' ? { grant: grant as RefreshGrant } : null
  } catch { return null }
}

/**
 * The grant behind a refresh token, which is spent: its place keeps a note of which key it belonged to. Presenting a spent
 * token again after the grace period means a copy of it was kept (OAuth 2.1 4.3.1), so the answer says to revoke that key
 * and the connection ends for whoever holds it, the legitimate client included.
 */
export async function takeRefreshToken(token: unknown): Promise<{ grant: RefreshGrant } | { reusedKeyId: string, revoke: boolean } | null> {
  if (typeof token !== 'string' || !token || token.length > 200) return null
  const redis = useRedis()
  const entry = readRefreshEntry(await redis.getdel(refreshKey(token)))
  if (entry && 'grant' in entry) await redis.set(refreshKey(token), `${USED_PREFIX}${entry.grant.apiKeyId}:${Date.now()}`, 'EX', OAUTH_REFRESH_DAYS * 24 * 60 * 60)
  return entry
}

/** The redirect a client is sent back to, with `code` or `error` and the `state` it gave. */
export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value)
  return url.toString()
}

/** The RFC 6749 error body. `statusMessage` is the description, so the panel and h3 read it too. */
export function oauthError(statusCode: number, error: string, description: string) {
  return createError({ statusCode, statusMessage: description, data: { error, error_description: description } })
}
