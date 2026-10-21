import { can } from '#shared/roles'
import { requireClient } from '../../../../utils/mcp/oauth'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'], operationId: 'previewOAuthAuthorization', security: [{ AgentSession: [] }],
    summary: 'What an AI assistant is asking to connect to',
    description: 'The consent page asks this before showing Approve: the assistant\'s name, and the workspace and projects it would act in. Panel session only. 400 when the client or redirect address is not one it registered.',
    parameters: [{ name: 'client_id', in: 'query', required: true, schema: { type: 'string' } }, { name: 'redirect_uri', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ client: { name, redirectHost }, workspace, projects, canApprove }`' }, 400: { description: 'Unknown client or redirect_uri.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const client = requireClient(query.client_id, query.redirect_uri)
  const projects = await new (useParse()).Query('Project').equalTo('workspace', ctx.workspace).ascending('name').limit(200).find(MASTER)
  return {
    client: { name: client.name, redirectHost: redirectHost(String(query.redirect_uri)) },
    workspace: { id: ctx.workspaceId, name: String(ctx.workspace.get('name') || '') },
    projects: projects.map(row => ({ id: row.id || '', name: String(row.get('name') || '') })),
    // A key limited to some projects, or a role that may not make keys, cannot hand out a broader one.
    canApprove: !ctx.apiKeyId && can(ctx.role, 'apiKeys.manage')
  }
})

/** Where the browser will land, for the operator to check: the host, or the app's own scheme (`cursor:`). */
function redirectHost(uri: string): string {
  const url = new URL(uri)
  return url.host || url.protocol
}
