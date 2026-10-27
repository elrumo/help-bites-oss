defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'inspectTransferSource',
    summary: 'Check another HelpBites before importing',
    description: 'Signs in to another instance with the given login and lists the workspaces and projects there that can be imported. Nothing is stored. Owners and admins.',
    security: [{ bearerAuth: [] }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, apiKey: { type: 'string' }, login: { type: 'string' }, password: { type: 'string' }, workspaceId: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ host, edition, workspace, workspaces, projects }`' }, 400: { description: 'Unreachable, or the login was refused, or the account is not an owner or admin there.' }, 429: { description: 'More than 20 checks in an hour.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export' })
  assertSession(ctx)
  await rateLimit(`sb:rl:transfer-inspect:${ctx.workspaceId}`, 20, 3600)
  return await inspectSource(readSource(await readBody(event).catch(() => ({}))))
})
