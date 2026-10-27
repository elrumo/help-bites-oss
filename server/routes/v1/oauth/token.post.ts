import { type H3Event } from 'h3'
import { can } from '#shared/roles'
import { CODE_TTL_SECONDS, OAUTH_KEY_DAYS, issueRefreshToken, pkceMatches, readClient, takeCode, takeRefreshToken } from '../../../utils/mcp/oauth'
import { newAdminApiKey, readKeyExpiry, saveAdminApiKey } from '../../../utils/adminApiKeys'
import { pointerId } from '../../../utils/parse'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'], operationId: 'oauthToken', security: [{}],
    summary: 'Exchange an authorization code for an access token',
    description: 'OAuth 2.1 authorization_code with PKCE S256 and rotating refresh_token grants, with no client secret. The access token is an admin API key for the approving operator and workspace, listed under Settings → API keys; revoking it disconnects the assistant. Form-encoded or JSON.',
    requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['grant_type'], properties: { grant_type: { type: 'string', enum: ['authorization_code', 'refresh_token'] }, code: { type: 'string' }, code_verifier: { type: 'string' }, client_id: { type: 'string' }, redirect_uri: { type: 'string' }, refresh_token: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ access_token, refresh_token, token_type: "Bearer", expires_in }`' }, 400: { description: '`invalid_grant`, `invalid_request` or `unsupported_grant_type`.' } }
  }
})

function failure(event: H3Event, error: string, description: string, status = 400) {
  setResponseStatus(event, status)
  setHeader(event, 'Cache-Control', 'no-store')
  return { error, error_description: description }
}

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:mcp-token:${clientIp(event) || 'ip'}`, 30, 60)
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (body.grant_type === 'refresh_token') {
    // Refresh tokens rotate on use and are bound to both the OAuth client and the revocable API-key row.
    if (!readClient(body.client_id)) return failure(event, 'invalid_client', 'Unknown OAuth client')
    const grant = await takeRefreshToken(body.refresh_token)
    if (!grant || grant.clientId !== body.client_id) return failure(event, 'invalid_grant', 'The refresh token is unknown, expired, or belongs to another client')

    const Parse = useParse()
    const row = await new Parse.Query('AdminApiKey').get(grant.apiKeyId, MASTER).catch(() => null)
    if (!row || pointerId(row.get('agent')) !== grant.agentId || pointerId(row.get('workspace')) !== grant.workspaceId) {
      return failure(event, 'invalid_grant', 'The API key for this connection was revoked')
    }

    const membership = (await membershipsOf(grant.agentId)).find(m => m.workspaceId === grant.workspaceId)
    const workspace = membership && can(membership.role, 'apiKeys.manage') ? await getWorkspace(grant.workspaceId) : null
    if (!workspace || String(workspace.get('status') || 'active') !== 'active') return failure(event, 'invalid_grant', 'This account can no longer renew this connection')

    const value = newAdminApiKey()
    const expiresAt = readKeyExpiry(OAUTH_KEY_DAYS)
    row.set('hash', value.hash)
    row.set('prefix', value.prefix)
    row.set('expiresAt', expiresAt)
    row.set('lastUsedAt', new Date())
    await row.save(null, MASTER)
    const refreshToken = await issueRefreshToken(grant)
    setHeader(event, 'Cache-Control', 'no-store')
    return { access_token: value.token, refresh_token: refreshToken, token_type: 'Bearer', expires_in: Math.floor((expiresAt!.getTime() - Date.now()) / 1000), scope: 'mcp offline_access' }
  }
  if (body.grant_type !== 'authorization_code') return failure(event, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported')

  // Taking the code spends it, whatever else is wrong: a code gets one try.
  const grant = await takeCode(body.code)
  if (!grant) return failure(event, 'invalid_grant', 'The code is unknown, used or expired')
  if (!readClient(body.client_id) || grant.clientId !== body.client_id || grant.redirectUri !== body.redirect_uri || !pkceMatches(body.code_verifier, grant.challenge)) {
    return failure(event, 'invalid_grant', 'The code does not match this client, redirect_uri or code_verifier')
  }

  // Approved a moment ago, but the operator may have left the workspace or lost the role since.
  const membership = (await membershipsOf(grant.agentId)).find(m => m.workspaceId === grant.workspaceId)
  const workspace = membership && can(membership.role, 'apiKeys.manage') ? await getWorkspace(grant.workspaceId) : null
  if (!workspace) return failure(event, 'invalid_grant', 'This account can no longer create API keys in that workspace')

  const Parse = useParse()
  const expiresAt = readKeyExpiry(OAUTH_KEY_DAYS)
  const { row, token } = await saveAdminApiKey({
    agent: Parse.User.createWithoutData(grant.agentId) as ParseObject,
    workspace,
    name: `MCP: ${grant.clientName}`.slice(0, 80),
    projectIds: grant.projectIds,
    expiresAt,
    readOnly: grant.readOnly === true
  })
  const refreshToken = await issueRefreshToken({ agentId: grant.agentId, workspaceId: grant.workspaceId, clientId: String(body.client_id), apiKeyId: row.id || '' })
  setHeader(event, 'Cache-Control', 'no-store')
  return { access_token: token, refresh_token: refreshToken, token_type: 'Bearer', expires_in: Math.floor((expiresAt!.getTime() - Date.now()) / 1000), scope: 'mcp offline_access' }
})
