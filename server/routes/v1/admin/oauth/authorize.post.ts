import { issueCode, redirectWith, requireClient, validChallenge } from '../../../../utils/mcp/oauth'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'], operationId: 'approveOAuthAuthorization', security: [{ AgentSession: [] }],
    summary: 'Approve an AI assistant\'s connection',
    description: 'Called by the consent page when the operator clicks Approve. Needs a panel session (an API key cannot approve a new one) and the role that may manage API keys. Returns where to send the browser: the assistant\'s redirect address with a one-use `code` that expires in two minutes. The API key itself is minted when the assistant exchanges the code at `/v1/oauth/token`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['clientId', 'redirectUri', 'codeChallenge'], properties: { clientId: { type: 'string' }, redirectUri: { type: 'string' }, codeChallenge: { type: 'string', description: 'PKCE S256' }, state: { type: 'string' }, projectIds: { type: 'array', items: { type: 'string' }, description: 'Limit the connection to these projects. Leave out for the whole workspace.' } } } } } },
    responses: { 200: { description: '`{ redirectTo }`' }, 400: { description: 'Unknown client, redirect address or challenge, or a project outside this workspace.' }, 402: { description: 'The plan\'s API key limit is reached.' }, 403: { description: 'Not a panel session, or the role cannot manage API keys.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  // A key could otherwise mint wider keys for itself through an assistant it controls.
  if (ctx.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Approve a connection from the panel, signed in', data: { code: 'session_required' } })
  await assertWorkspaceVerified(ctx.workspaceId)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const client = requireClient(body.clientId, body.redirectUri)
  if (!validChallenge(body.codeChallenge)) throw createError({ statusCode: 400, statusMessage: 'codeChallenge must be a PKCE S256 challenge' })
  const projectIds = await readKeyProjectIds(body.projectIds, ctx.workspaceId)
  await checkGauge(ctx.workspace, 'apiKeys')
  const code = await issueCode({ agentId: ctx.agentId, workspaceId: ctx.workspaceId, projectIds, clientId: String(body.clientId), redirectUri: String(body.redirectUri), challenge: body.codeChallenge, clientName: client.name })
  return { redirectTo: redirectWith(String(body.redirectUri), { code, state: String(body.state || '').slice(0, 500) }) }
})
