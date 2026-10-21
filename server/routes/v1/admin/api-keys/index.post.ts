defineRouteMeta({
  openAPI: {
    tags: ['Agent'], summary: 'Create a general admin API key', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    description: 'The returned `key` is shown once. It acts as you, in this workspace only, on every `/v1/admin` operation your role allows, so keep it in server-side secret storage. It expires after `expiresInDays` (1-365, default 90); pass `null` for a key that never expires.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', example: 'Production automation' }, projectIds: { type: 'array', items: { type: 'string' }, description: 'Limit the key to these projects. Leave out for every project and the workspace itself.' }, expiresInDays: { type: 'integer', minimum: 1, maximum: 365, nullable: true, default: 90 } } } } } },
    responses: { 200: { description: '{ apiKey, key }' }, 400: { description: 'Name is required, or `projectIds` is empty or names a project outside this workspace.' }, 402: { description: 'The plan\'s API key limit is reached.' }, 403: { description: '`email_unverified`: the workspace owner has not confirmed their email address yet (hosted edition).' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  await assertWorkspaceVerified(ctx.workspaceId)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim().slice(0, 80)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  const projectIds = await readKeyProjectIds(body.projectIds, ctx.workspaceId)
  const expiresAt = readKeyExpiry(body.expiresInDays)
  await checkGauge(ctx.workspace, 'apiKeys')
  const { row, token } = await saveAdminApiKey({ agent: ctx.agent, workspace: ctx.workspace, name, projectIds, expiresAt })
  return { apiKey: serializeAdminApiKey(row), key: token }
})
