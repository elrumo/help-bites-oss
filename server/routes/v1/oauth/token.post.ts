import { type H3Event } from 'h3'
import { can } from '#shared/roles'
import { CODE_TTL_SECONDS, OAUTH_KEY_DAYS, pkceMatches, readClient, takeCode } from '../../../utils/mcp/oauth'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'], operationId: 'oauthToken', security: [{}],
    summary: 'Exchange an authorization code for an access token',
    description: 'RFC 6749 with PKCE S256 and no client secret. The `access_token` is an admin API key (`ak_…`) for the operator and workspace that approved the connection, valid for a year and listed under Settings → API keys, where revoking it disconnects the assistant. There are no refresh tokens: an assistant signs in again when the key expires. Form-encoded or JSON.',
    requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['grant_type', 'code', 'code_verifier', 'client_id', 'redirect_uri'], properties: { grant_type: { type: 'string', enum: ['authorization_code'] }, code: { type: 'string' }, code_verifier: { type: 'string' }, client_id: { type: 'string' }, redirect_uri: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ access_token, token_type: "Bearer", expires_in }`' }, 400: { description: '`invalid_grant`, `invalid_request` or `unsupported_grant_type`.' } }
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
  if (body.grant_type !== 'authorization_code') return failure(event, 'unsupported_grant_type', 'Only authorization_code is supported')

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
  const { token } = await saveAdminApiKey({
    agent: Parse.User.createWithoutData(grant.agentId) as ParseObject,
    workspace,
    name: `MCP: ${grant.clientName}`.slice(0, 80),
    projectIds: grant.projectIds,
    expiresAt
  })
  setHeader(event, 'Cache-Control', 'no-store')
  return { access_token: token, token_type: 'Bearer', expires_in: Math.floor((expiresAt!.getTime() - Date.now()) / 1000), scope: 'mcp' }
})
